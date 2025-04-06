import { randomUUID } from 'crypto';
import { VMCPDefinition, NewVMCPDefinition } from './types.js';
import { VMCPInstance } from './instance.js';
import { TransportManager } from '../transport/manager.js';
import { ConfigManager } from '../config/manager.js';

// Simple in-memory store for vMCP definitions
const vmcpStore: Record<string, VMCPDefinition> = {};

export class VMCPManager {
    private runningInstances: Map<string, VMCPInstance> = new Map();

    constructor(
        private transportManager: TransportManager, // Needed for VMCPInstance
        private configManager: ConfigManager // Needed to check sourceServerIds
    ) {}

    getTransportManager(): TransportManager {
        return this.transportManager;
    }

    async addVMCP(definitionData: NewVMCPDefinition): Promise<VMCPDefinition> {
        const id = randomUUID();
        const now = new Date().toISOString();

        // Basic validation
        if (!definitionData.name || !definitionData.port || !definitionData.sourceServerIds || definitionData.sourceServerIds.length === 0) {
            throw new Error('Missing required fields: name, port, sourceServerIds');
        }
        if (this.isPortInUse(definitionData.port)) {
             throw new Error(`Port ${definitionData.port} is already in use by another vMCP or the main server.`);
        }
        this.validateSourceServers(definitionData.sourceServerIds);

        const newDefinition: VMCPDefinition = {
            ...definitionData,
            id,
            status: 'stopped', // Start as stopped
            underlyingServersStatus: [],
            createdAt: now,
            updatedAt: now,
        };

        vmcpStore[id] = newDefinition;
        console.log(`Added new vMCP definition: ${newDefinition.name} (ID: ${id})`);

        // Start the instance after adding
        try {
            // Ensure the status is updated *before* starting
            vmcpStore[id].status = 'starting';
            vmcpStore[id].updatedAt = new Date().toISOString();
            await this.startVMCP(id);
            // Status ('running' or 'error') will be set within startVMCP
        } catch (error) {
            console.error(`Failed to auto-start vMCP ${id} after creation:`, error);
            // Ensure status is marked as error if startVMCP throws immediately
            if (vmcpStore[id]) { // Check if definition still exists
                vmcpStore[id].status = 'error';
                vmcpStore[id].updatedAt = new Date().toISOString();
            }
            // Optionally re-throw or handle differently if needed
        }

        // Return the definition (its status might be starting, running, or error)
        return vmcpStore[id];
    }

    async removeVMCP(id: string): Promise<void> {
        const definition = vmcpStore[id];
        if (!definition) {
            throw new Error(`vMCP with ID ${id} not found.`);
        }

        // Ensure running instance is stopped before removing definition
        try {
             await this.stopVMCP(id);
        } catch (stopError) {
             console.error(`Error stopping vMCP instance ${id} during removal, proceeding with definition removal:`, stopError);
             // Decide if deletion should proceed even if stop fails. For now, we log and continue.
        }

        delete vmcpStore[id];
        console.log(`Removed vMCP definition: ${definition.name} (ID: ${id})`);
    }

    getVMCP(id: string): VMCPDefinition | null {
        return vmcpStore[id] || null;
    }

    getVMCPInstance(id: string): VMCPInstance | null {
        return this.runningInstances.get(id) || null;
    }

    listVMCPs(): VMCPDefinition[] {
        return Object.values(vmcpStore);
    }

    // TODO: Implement start/stop/load/unload logic
    async startVMCP(id: string): Promise<void> {
        const definition = vmcpStore[id];
        if (!definition) {
            throw new Error(`vMCP with ID ${id} not found.`);
        }
        if (this.runningInstances.has(id)) {
            console.warn(`vMCP instance ${id} is already running.`);
            return;
        }

        console.log(`Starting vMCP instance ${id} (${definition.name})...`);
        definition.status = 'starting';
        definition.updatedAt = new Date().toISOString();

        let instance: VMCPInstance | undefined;
        try {
            instance = new VMCPInstance(definition, this.transportManager);
            this.runningInstances.set(id, instance);
            await instance.start(); // Implement this method in VMCPInstance
            definition.status = 'running'; // Assuming start() is successful
            console.log(`vMCP instance ${id} started successfully on port ${definition.port}.`);
        } catch (error) {
            console.error(`Failed to start vMCP instance ${id}:`, error);
            definition.status = 'error';
            if (instance) {
                this.runningInstances.delete(id); // Clean up failed instance
            }
            throw error; // Re-throw to signal failure
        }
    }

    async stopVMCP(id: string): Promise<void> {
        const definition = vmcpStore[id];
        const instance = this.runningInstances.get(id);

        if (!definition) {
            console.warn(`vMCP definition ${id} not found during stop request.`);
            // If instance exists without definition (shouldn't happen), try stopping anyway
        }

        if (!instance) {
            console.warn(`vMCP instance ${id} is not running.`);
            if (definition) definition.status = 'stopped'; // Ensure status is correct
            return;
        }

        console.log(`Stopping vMCP instance ${id} (${definition?.name || 'Unknown'})...`);
        try {
            await instance.stop(); // Implement this method in VMCPInstance
            if (definition) definition.status = 'stopped';
            console.log(`vMCP instance ${id} stopped successfully.`);
        } catch (error) {
            console.error(`Failed to stop vMCP instance ${id}:`, error);
            if (definition) definition.status = 'error'; // Mark as error if stop failed?
            throw error; // Re-throw?
        } finally {
            this.runningInstances.delete(id);
             if (definition) definition.updatedAt = new Date().toISOString();
        }
    }

    async loadAll(): Promise<void> {
        console.log('Loading all vMCP instances...');
        const definitions = this.listVMCPs();
        const startPromises = definitions.map(def => this.startVMCP(def.id).catch(err => {
            console.error(`Failed to auto-start vMCP ${def.id} (${def.name}):`, err);
            // Status should be set to 'error' within startVMCP
        }));
        await Promise.all(startPromises);
        console.log('Finished attempting to load all vMCP instances.');
    }

    async stopAll(): Promise<void> {
        console.log('Stopping all running vMCP instances...');
        const runningIds = Array.from(this.runningInstances.keys());
        const stopPromises = runningIds.map(id => this.stopVMCP(id).catch(err => {
            console.error(`Failed to stop vMCP ${id}:`, err);
            // Status should be updated within stopVMCP
        }));
        await Promise.all(stopPromises);
        console.log('Finished attempting to stop all vMCP instances.');
    }

    // --- Helper Methods ---

    private isPortInUse(port: number): boolean {
        // Check against main server port (assuming default 3000 for now)
        // TODO: Get actual main server port from config/env
        if (port === 3000) return true;

        // Check against other vMCPs
        for (const vmcp of Object.values(vmcpStore)) {
            if (vmcp.port === port) return true;
        }
        return false;
    }

    private validateSourceServers(sourceServerIds: string[]): void {
        const currentConfig = this.configManager.getConfig();
        const knownServerIds = new Set(currentConfig.mcpServers.map(s => s.name)); // Assuming name is the ID
        for (const sourceId of sourceServerIds) {
            if (!knownServerIds.has(sourceId)) {
                throw new Error(`Source MCP server with ID '${sourceId}' not found in configuration.`);
            }
        }
    }
} 