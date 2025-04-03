import { MCPServer, vMCPInstance } from '../models/types.js';

export interface PersistenceLayer {
  // MCP Server operations
  getMCPServers(): Promise<MCPServer[]>;
  getMCPServer(name: string): Promise<MCPServer | null>;
  createMCPServer(server: Omit<MCPServer, 'createdAt' | 'updatedAt'>): Promise<MCPServer>;
  updateMCPServer(name: string, server: Partial<MCPServer>): Promise<MCPServer>;
  deleteMCPServer(name: string): Promise<void>;
  
  // vMCP Instance operations
  getvMCPInstances(): Promise<vMCPInstance[]>;
  getvMCPInstance(id: string): Promise<vMCPInstance | null>;
  createvMCPInstance(instance: Omit<vMCPInstance, 'createdAt' | 'updatedAt'>): Promise<vMCPInstance>;
  updatevMCPInstance(id: string, instance: Partial<vMCPInstance>): Promise<vMCPInstance>;
  deletevMCPInstance(id: string): Promise<void>;
}

export class InMemoryPersistence implements PersistenceLayer {
  private mcpServers: Map<string, MCPServer> = new Map();
  private vMCPInstances: Map<string, vMCPInstance> = new Map();

  // MCP Server operations
  async getMCPServers(): Promise<MCPServer[]> {
    return Array.from(this.mcpServers.values());
  }

  async getMCPServer(name: string): Promise<MCPServer | null> {
    return this.mcpServers.get(name) || null;
  }

  async createMCPServer(server: Omit<MCPServer, 'createdAt' | 'updatedAt'>): Promise<MCPServer> {
    const now = new Date();
    const newServer: MCPServer = {
      ...server,
      createdAt: now,
      updatedAt: now
    };
    this.mcpServers.set(server.name, newServer);
    return newServer;
  }

  async updateMCPServer(name: string, server: Partial<MCPServer>): Promise<MCPServer> {
    const existing = this.mcpServers.get(name);
    if (!existing) {
      throw new Error(`MCP Server ${name} not found`);
    }
    const updated: MCPServer = {
      ...existing,
      ...server,
      updatedAt: new Date()
    };
    this.mcpServers.set(name, updated);
    return updated;
  }

  async deleteMCPServer(name: string): Promise<void> {
    this.mcpServers.delete(name);
  }

  // vMCP Instance operations
  async getvMCPInstances(): Promise<vMCPInstance[]> {
    return Array.from(this.vMCPInstances.values());
  }

  async getvMCPInstance(id: string): Promise<vMCPInstance | null> {
    return this.vMCPInstances.get(id) || null;
  }

  async createvMCPInstance(instance: Omit<vMCPInstance, 'createdAt' | 'updatedAt'>): Promise<vMCPInstance> {
    const now = new Date();
    const newInstance: vMCPInstance = {
      ...instance,
      createdAt: now,
      updatedAt: now
    };
    this.vMCPInstances.set(instance.id, newInstance);
    return newInstance;
  }

  async updatevMCPInstance(id: string, instance: Partial<vMCPInstance>): Promise<vMCPInstance> {
    const existing = this.vMCPInstances.get(id);
    if (!existing) {
      throw new Error(`vMCP Instance ${id} not found`);
    }
    const updated: vMCPInstance = {
      ...existing,
      ...instance,
      updatedAt: new Date()
    };
    this.vMCPInstances.set(id, updated);
    return updated;
  }

  async deletevMCPInstance(id: string): Promise<void> {
    this.vMCPInstances.delete(id);
  }
} 