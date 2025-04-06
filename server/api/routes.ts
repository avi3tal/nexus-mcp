import express, { Request, Response } from 'express';
import { ServiceRegistry } from '../services/registry.js';
import { MCPServerConfig, vMCPConfig } from '../config/types.js';
import { CapabilityError } from '../capabilities/errors.js';
import { SSETransport } from '../transport/SSETransport.js';
import { TransportManager } from '../transport/TransportManager.js';
import type { JSONRPCMessage, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';
import { VMCPDefinition, NewVMCPDefinition } from '../vmcp/types.js';
import { VMCPServer } from '../vmcp/server.js';

export function setupRoutes(app: express.Application): void {
  const router = express.Router();
  const registry = ServiceRegistry.getInstance();
  const vmcpManager = registry.getVMCPManager(); 

  /**
   * @swagger
   * /api/mcp-servers:
   *   get:
   *     summary: List all MCP servers
   *     tags: [MCP Servers]
   *     responses:
   *       200:
   *         description: List of MCP servers
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/MCPServer'
   */
  router.get('/mcp-servers', (req, res) => {
    const configManager = registry.getConfigManager();
    const config = configManager.getConfig();
    
    // DEBUG: Log the config being used by this route
    console.log('[API /api/mcp-servers GET] ConfigManager state:', JSON.stringify(config, null, 2));
    console.log('[API /api/mcp-servers GET] Servers found in config:', config.mcpServers);

    // 1. Get physical MCP servers
    const physicalServers = (config.mcpServers || []).map(server => ({
      ...server,
      id: server.name,
      isVirtual: false // Explicitly mark as physical
    }));
    
    // 2. Get vMCP definitions and convert to MCPServer format
    const vmcpDefinitions = vmcpManager.listVMCPs();
    
    // Convert vMCP definitions to the expected MCPServer format
    const virtualServers = vmcpDefinitions.map(vmcp => ({
      id: vmcp.id,
      name: vmcp.name,
      url: `http://localhost:${vmcp.port}`,
      transport: 'sse',
      status: vmcp.status === 'running' ? 'online' : vmcp.status === 'error' ? 'error' : 'offline',
      lastSeen: vmcp.updatedAt,
      tools: [], // These will be populated when the client requests capabilities
      prompts: [],
      resources: [],
      isVirtual: true, // Mark as virtual MCP
      isDisabled: vmcp.status !== 'running', // Disabled if not running
      port: vmcp.port // Include port for reference
    }));
    
    // 3. Combine both types of servers
    const responseData = [...physicalServers, ...virtualServers];
    
    // DEBUG: Log the response data being sent
    console.log('[API /api/mcp-servers GET] Response data being sent:', responseData);
    
    res.json(responseData);
  });

  /**
   * @swagger
   * /api/mcp-servers:
   *   post:
   *     summary: Add a new MCP server
   *     tags: [MCP Servers]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/MCPServer'
   *     responses:
   *       201:
   *         description: MCP server created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/MCPServer'
   *       400:
   *         description: Invalid input
   */
  router.post('/mcp-servers', async (req, res) => {
    try {
      const serverConfig = req.body as MCPServerConfig;
      const configManager = registry.getConfigManager();
      const transportManager = registry.getTransportManager(); // No cast needed if logic is correct
      const discoverer = registry.getCapabilityDiscoverer();
      
      // Check for duplicates before doing anything else
      const currentConfig = configManager.getConfig();
      const existingServer = currentConfig.mcpServers.find(s => s.name === serverConfig.name || s.url === serverConfig.url);
      if (existingServer) {
        return res.status(400).json({ error: `Server with name '${serverConfig.name}' or URL '${serverConfig.url}' already exists.` });
      }
      
      // Try to set up transport, connect, and discover capabilities
      try {
        console.log(`Setting up transport for ${serverConfig.name} at ${serverConfig.url}/sse`);
        // 1. Create the transport instance
        const transport = new SSETransport(`${serverConfig.url}/sse`, {
          'Accept': 'text/event-stream',
          'Connection': 'keep-alive'
        }, {
          maxRetries: 3, 
          retryDelay: 1000,
          timeout: 30000
        });

        // 2. Add the transport to the manager
        transportManager.addTransport(serverConfig.name, transport);

        // 3. Connect using the manager (this calls transport.start())
        await transportManager.connect(serverConfig.name);
        console.log(`Transport connected for ${serverConfig.name}.`);

        // Attach handlers to the transport instance (we can still use the 'transport' variable)
        transport.onerror = (error: Error) => {
          console.error(`Transport error for ${serverConfig.name}:`, error);
          // Update status in config
          const latestConfig = configManager.getConfig();
          const updated = latestConfig.mcpServers.map(s => s.name === serverConfig.name ? { ...s, status: 'error' as const } : s);
          configManager.updateConfig({ ...latestConfig, mcpServers: updated });
        };
        transport.onclose = () => {
          console.log(`Transport closed for ${serverConfig.name}`);
          // Update status in config
          const latestConfig = configManager.getConfig();
          const updated = latestConfig.mcpServers.map(s => s.name === serverConfig.name ? { ...s, status: 'offline' as const } : s);
          configManager.updateConfig({ ...latestConfig, mcpServers: updated });
        };
        
        console.log(`Discovering capabilities for ${serverConfig.name}...`);
        await discoverer.discoverCapabilities(serverConfig.name);
        console.log(`Capabilities discovered for ${serverConfig.name}.`);
        
        // 4. Update the config with the new server ONLY after success
        const configAfterDiscovery = configManager.getConfig();
        const newServerList = [
          ...configAfterDiscovery.mcpServers,
          { 
            ...serverConfig, 
            status: 'online' as const, 
            lastSeen: new Date().toISOString(),
            capabilities: undefined // Clear any request capabilities
          }
        ];
        configManager.updateConfig({ ...configAfterDiscovery, mcpServers: newServerList });

        // Fetch the final config and capabilities for response
        const finalConfig = configManager.getConfig();
        const finalServerData = finalConfig.mcpServers.find(s => s.name === serverConfig.name);
        if (!finalServerData) throw new Error('Server data not found after update');

        const capabilityRegistry = registry.getCapabilityRegistry();
        const discoveredCapabilities = {
          tools: capabilityRegistry.getToolsForServer(serverConfig.name),
          prompts: capabilityRegistry.getPromptsForServer(serverConfig.name),
          resources: capabilityRegistry.getResourcesForServer(serverConfig.name)
        };
        
        const responseData = {
           ...finalServerData,
           id: finalServerData.name,
           capabilities: discoveredCapabilities
        };

        res.status(201).json(responseData);

      } catch (error) {
        console.error(`Failed to setup or discover for server ${serverConfig.name}:`, error);
        // Remove transport if setup failed
        transportManager.removeTransport(serverConfig.name);
        
        // Don't add the server to config if setup failed
        res.status(500).json({ 
          error: 'Failed to connect to server or discover capabilities',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    } catch (error) {
      // Outer catch for initial validation errors (like duplicate check)
      console.error('Failed to add server (initial validation):', error);
      res.status(400).json({ 
        error: 'Invalid input or server already exists',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * @swagger
   * tags:
   *   name: vMCP Instances
   *   description: Managing Virtual MCP Instances
   */

  /**
   * @swagger
   * /api/vmcp-servers:
   *   get:
   *     summary: List all vMCP instances
   *     tags: [vMCP Instances]
   *     responses:
   *       200:
   *         description: List of vMCP instances
   */
  router.get('/vmcp-servers', (req, res) => {
    try {
      const vmcpManager = registry.getVMCPManager();
      const definitions = vmcpManager.listVMCPs();
      res.json(definitions);
    } catch (error) {
      console.error('Failed to list vMCP instances:', error);
      res.status(500).json({ error: 'Failed to list vMCP instances' });
    }
  });

  /**
   * @swagger
   * /api/vmcp-servers:
   *   post:
   *     summary: Create a new vMCP instance
   *     tags: [vMCP Instances]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/NewVMCPDefinition' # Use the specific schema for creation
   *     responses:
   *       201:
   *         description: vMCP instance definition created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/VMCPDefinition'
   *       400:
   *         description: Invalid input (e.g., missing fields, port conflict)
   *       500:
   *         description: Internal server error during creation
   */
  router.post('/vmcp-servers', async (req, res) => {
    try {
      // Extract params from request body
      const { name, port, sourceServerIds, aggregationRules } = req.body;
      
      console.log('[POST /vmcp-servers] Request payload:', {
        name,
        port,
        sourceServerIds,
        aggregationRules
      });
      
      // Basic validation
      if (!name || !port || !sourceServerIds || sourceServerIds.length === 0) {
        return res.status(400).json({ error: 'Missing required fields: name, port, sourceServerIds' });
      }

      if (!aggregationRules || aggregationRules.length === 0) {
        return res.status(400).json({ error: 'At least one aggregation rule is required' });
      }

      // Validate aggregation rules
      const validRuleTypes = ['aggregate_all', 'include_tools', 'include_prompts', 'include_resources'] as const;
      const invalidRule = aggregationRules.find((rule: { type: string }) => !validRuleTypes.includes(rule.type as any));
      if (invalidRule) {
        return res.status(400).json({ 
          error: 'Invalid aggregation rule type', 
          details: `Rule type '${invalidRule.type}' is not supported` 
        });
      }

      // Create the vMCP definition
      const definitionData: NewVMCPDefinition = {
        name,
        port,
        sourceServerIds,
        aggregationRules
      };

      const newDefinition = await vmcpManager.addVMCP(definitionData);
      res.status(201).json(newDefinition);
    } catch (error) {
      console.error("[POST /vmcp-servers] Error creating vMCP:", error);
      if (error instanceof Error && (error.message.includes('Port') || error.message.includes('Source MCP server'))) {
        res.status(400).json({ error: 'Invalid input', details: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create vMCP instance', details: error instanceof Error ? error.message : String(error) });
      }
    }
  });

  /**
   * @swagger
   * /api/vmcp-servers/{id}:
   *   get:
   *     summary: Get a vMCP instance by ID
   *     tags: [vMCP Instances]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: vMCP instance
   *       404:
   *         description: vMCP not found
   */
  router.get('/vmcp-servers/:id', (req, res) => {
    try {
      const { id } = req.params;
      const vmcpManager = registry.getVMCPManager();
      const definition = vmcpManager.getVMCP(id);
      
      if (!definition) {
        return res.status(404).json({ error: `vMCP with ID ${id} not found` });
      }
      
      res.json(definition);
    } catch (error) {
      console.error(`Failed to get vMCP instance ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to get vMCP instance' });
    }
  });

  /**
   * @swagger
   * /api/vmcp-servers/{id}:
   *   delete:
   *     summary: Delete a vMCP instance
   *     tags: [vMCP Instances]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: vMCP deleted
   *       404:
   *         description: vMCP not found
   *       500:
   *         description: Error deleting vMCP
   */
  router.delete('/vmcp-servers/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await vmcpManager.removeVMCP(id);
      res.status(204).send();
    } catch (error) {
      console.error(`Error deleting vMCP ${req.params.id}:`, error);
      
      if (error instanceof Error && error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      
      res.status(500).json({ 
        error: 'Failed to delete vMCP instance',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

   /**
   * @swagger
   * /api/vmcp-servers/{id}/start:
   *   post:
   *     summary: Start a vMCP instance
   *     tags: [vMCP Instances]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: vMCP started successfully
   *       404:
   *         description: vMCP not found
   */
   router.post('/vmcp-servers/:id/start', async (req, res) => {
      try {
        const { id } = req.params;
        const vmcpManager = registry.getVMCPManager();
        await vmcpManager.startVMCP(id);
        
        const definition = vmcpManager.getVMCP(id);
        if (!definition) {
          return res.status(404).json({ error: `vMCP with ID ${id} not found` });
        }
        
        res.json({
          id,
          status: definition.status,
          message: 'vMCP started successfully'
        });
      } catch (error) {
        console.error(`Failed to start vMCP instance ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to start vMCP instance' });
      }
   });

   /**
   * @swagger
   * /api/vmcp-servers/{id}/stop:
   *   post:
   *     summary: Stop a vMCP instance
   *     tags: [vMCP Instances]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: vMCP stopped successfully
   *       404:
   *         description: vMCP not found
   */
  router.post('/vmcp-servers/:id/stop', async (req, res) => {
      try {
        const { id } = req.params;
        const vmcpManager = registry.getVMCPManager();
        await vmcpManager.stopVMCP(id);
        
        const definition = vmcpManager.getVMCP(id);
        if (!definition) {
          return res.status(404).json({ error: `vMCP with ID ${id} not found` });
        }
        
        res.json({
          id,
          status: definition.status,
          message: 'vMCP stopped successfully'
        });
      } catch (error) {
        console.error(`Failed to stop vMCP instance ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to stop vMCP instance' });
      }
  });

  /**
   * @swagger
   * /api/vmcp-servers/{id}/health:
   *   get:
   *     summary: Get vMCP instance health status
   *     tags: [vMCP Instances]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: vMCP health status
   *       404:
   *         description: vMCP not found
   */
  router.get('/vmcp-servers/:id/health', async (req, res) => {
    try {
      const { id } = req.params;
      const vmcpManager = registry.getVMCPManager();
      const definition = vmcpManager.getVMCP(id);
      
      if (!definition) {
        return res.status(404).json({ error: `vMCP with ID ${id} not found` });
      }
      
      const server = new VMCPServer(id, vmcpManager);
      const health = await server.checkHealth();
      
      res.json(health);
    } catch (error) {
      console.error(`Failed to get vMCP health status ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to get vMCP health status' });
    }
  });

  /**
   * @swagger
   * /api/resources:
   *   get:
   *     summary: List all available resources (combined from all servers)
   *     tags: [Resources]
   *     responses:
   *       200:
   *         description: List of resources
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Resource' // Assuming a Resource schema exists
   */
  router.get('/resources', (req, res) => {
    // TODO: Implement logic to fetch and combine resources from all servers
    // For now, return an empty array
    console.log("Fetching combined resources..."); // Log for debugging
    res.json([]);
  });

  /**
   * @swagger
   * /api/mcp-servers/{serverId}/capabilities:
   *   get:
   *     summary: Get capabilities of an MCP server
   *     tags: [MCP Servers]
   *     parameters:
   *       - in: path
   *         name: serverId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Server capabilities
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tools:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Tool'
   *                 prompts:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Prompt'
   *       404:
   *         description: Server not found
   *       500:
   *         description: Failed to discover capabilities
   */
  router.get('/mcp-servers/:serverId/capabilities', async (req, res) => {
    try {
      const { serverId } = req.params;
      
      // Check if this is a vMCP server first
      const vmcpManager = registry.getVMCPManager();
      const vmcpDefinition = vmcpManager.getVMCP(serverId);
      
      if (vmcpDefinition) {
        // This is a vMCP - check if it's running
        if (vmcpDefinition.status !== 'running') {
          return res.status(400).json({ 
            error: 'vMCP is not running',
            details: 'Start the vMCP to access its capabilities'
          });
        }
        
        try {
          // Create a temporary SSE transport to communicate with the vMCP
          // This is needed because vMCPs follow the MCP protocol
          const tempTransport = new SSETransport(`http://localhost:${vmcpDefinition.port}/sse`);
          
          // Temporarily add the transport (will be removed after use)
          const transportManager = registry.getTransportManager();
          const tempServerId = `temp-vmcp-${serverId}-${Date.now()}`;
          transportManager.addTransport(tempServerId, tempTransport);
          
          try {
            // Connect to the vMCP
            await transportManager.connect(tempServerId);
            
            // Request capabilities
            const toolsResponse = await transportManager.request(tempServerId, {
              jsonrpc: '2.0',
              id: `capabilities-tools-${Date.now()}`,
              method: 'tools/list'
            });
            
            const promptsResponse = await transportManager.request(tempServerId, {
              jsonrpc: '2.0',
              id: `capabilities-prompts-${Date.now()}`,
              method: 'prompts/list'
            });
            
            const resourcesResponse = await transportManager.request(tempServerId, {
              jsonrpc: '2.0',
              id: `capabilities-resources-${Date.now()}`,
              method: 'resources/list'
            });
            
            // Disconnect and clean up
            await transportManager.disconnect(tempServerId);
            transportManager.removeTransport(tempServerId);
            
            // Return the capabilities
            return res.json({
              tools: toolsResponse?.result?.tools || [],
              prompts: promptsResponse?.result?.prompts || [],
              resources: resourcesResponse?.result?.resources || []
            });
          } catch (error) {
            // Ensure transport is removed in case of error
            try {
              await transportManager.disconnect(tempServerId);
              transportManager.removeTransport(tempServerId);
            } catch (cleanupError) {
              console.error(`Error cleaning up temporary transport:`, cleanupError);
            }
            
            throw error;
          }
        } catch (error) {
          console.error(`Error fetching capabilities from vMCP ${serverId}:`, error);
          return res.status(500).json({
            error: 'Failed to fetch vMCP capabilities',
            details: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      // Not a vMCP, proceed with standard capability discovery
      const discoverer = registry.getCapabilityDiscoverer();
      const capabilityRegistry = registry.getCapabilityRegistry();

      // Ensure capabilities are discovered/refreshed first (might be redundant if already done)
      await discoverer.discoverCapabilities(serverId);
      
      // Fetch capabilities specific to this serverId
      const tools = capabilityRegistry.getToolsForServer(serverId) || [];
      const prompts = capabilityRegistry.getPromptsForServer(serverId) || [];
      const resources = capabilityRegistry.getResourcesForServer(serverId) || []; // Assuming this exists too
      
      console.log(`Returning capabilities for ${serverId}:`, { tools, prompts, resources });
      res.json({
        tools: Object.values(tools), // Convert record to array if needed
        prompts: Object.values(prompts),
        resources: Object.values(resources) 
      });
    } catch (error) {
      if (error instanceof CapabilityError) {
        res.status(404).json({ error: error.message });
      } else if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'An unknown error occurred' });
      }
    }
  });

  /**
   * @swagger
   * /api/mcp-servers/{serverId}/capabilities/refresh:
   *   post:
   *     summary: Refresh capabilities of an MCP server
   *     tags: [MCP Servers]
   *     parameters:
   *       - in: path
   *         name: serverId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Capabilities refreshed
   *       404:
   *         description: Server not found
   *       500:
   *         description: Failed to refresh capabilities
   */
  router.post('/mcp-servers/:serverId/capabilities/refresh', async (req, res) => {
    try {
      const { serverId } = req.params;
      const discoverer = registry.getCapabilityDiscoverer();
      await discoverer.discoverCapabilities(serverId);
      res.json({ status: 'refreshed' });
    } catch (error) {
      if (error instanceof CapabilityError) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to refresh capabilities' });
      }
    }
  });

  /**
   * @swagger
   * /api/mcp-servers/{serverId}/test:
   *   post:
   *     summary: Test connection to an MCP server
   *     tags: [MCP Servers]
   *     parameters:
   *       - in: path
   *         name: serverId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Server test successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                 capabilities:
   *                   type: object
   *       404:
   *         description: Server not found
   *       500:
   *         description: Test failed
   */
  router.post('/mcp-servers/:serverId/test', async (req, res) => {
    try {
      const { serverId } = req.params;
      const discoverer = registry.getCapabilityDiscoverer();
      await discoverer.discoverCapabilities(serverId);
      
      const capabilityRegistry = registry.getCapabilityRegistry();
      res.json({
        status: 'online',
        capabilities: {
          tools: capabilityRegistry.getAllTools(),
          prompts: capabilityRegistry.getAllPrompts()
        }
      });
    } catch (error) {
      if (error instanceof CapabilityError) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to test server connection' });
      }
    }
  });

  /**
   * @swagger
   * /api/mcp-servers/{serverId}:
   *   delete:
   *     summary: Remove an MCP server
   *     tags: [MCP Servers]
   *     parameters:
   *       - in: path
   *         name: serverId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: Server removed
   *       404:
   *         description: Server not found
   */
  router.delete('/mcp-servers/:serverId', async (req, res) => {
    const { serverId } = req.params;
    const configManager = registry.getConfigManager();
    const transportManager = registry.getTransportManager() as unknown as TransportManager;
    const currentConfig = configManager.getConfig();
    
    const serverIndex = currentConfig.mcpServers.findIndex(s => s.name === serverId);
    if (serverIndex === -1) {
      res.status(404).json({ error: `Server ${serverId} not found` });
      return;
    }
    
    // Disconnect transport first
    try {
      await transportManager.disconnect(serverId);
      console.log(`Transport disconnected for server ${serverId}`);
    } catch (error) {
      console.error(`Error disconnecting transport for server ${serverId}:`, error);
      // Continue with deletion even if disconnect fails, but log it
    }
    
    // Remove from config
    const updatedServers = [...currentConfig.mcpServers];
    updatedServers.splice(serverIndex, 1);
    
    configManager.updateConfig({
      mcpServers: updatedServers
    });
    
    // Optional: Remove capabilities from registry (implement removeCapabilitiesForServer first)
    // const capabilityRegistry = registry.getCapabilityRegistry();
    // capabilityRegistry.removeCapabilitiesForServer(serverId);

    res.status(204).send();
  });

  /**
   * @swagger
   * /api/mcp-servers/{serverId}/connection:
   *   put:
   *     summary: Toggle server connection state (disconnect/connect)
   *     tags: [MCP Servers]
   *     parameters:
   *       - in: path
   *         name: serverId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               isDisabled:
   *                 type: boolean
   *                 description: Whether the server should be disconnected
   *     responses:
   *       200:
   *         description: Connection state updated
   *       404:
   *         description: Server not found
   */
  router.put('/mcp-servers/:serverId/connection', async (req, res) => {
    const { serverId } = req.params;
    const { isDisabled } = req.body;
    const configManager = registry.getConfigManager();
    const transportManager = registry.getTransportManager(); // Removed cast
    const currentConfig = configManager.getConfig();
    
    const serverIndex = currentConfig.mcpServers.findIndex(s => s.name === serverId);
    if (serverIndex === -1) {
      return res.status(404).json({ error: `Server ${serverId} not found` });
    }
    
    const serverToUpdate = currentConfig.mcpServers[serverIndex];
    let updatedStatus: MCPServerConfig['status'] = serverToUpdate.status;

    // Handle connection/disconnection
    if (isDisabled) {
      // Disconnect
      try {
        await transportManager.disconnect(serverId);
        updatedStatus = 'offline';
        console.log(`Transport disconnected for server ${serverId} via PUT`);
        
        // If disconnecting, clear any capabilities from CapabilityRegistry
        const capabilityRegistry = registry.getCapabilityRegistry();
        // TODO: capabilityRegistry.removeCapabilitiesForServer(serverId); 
        console.log(`Disconnecting server ${serverId}, capabilities should be cleared`);

      } catch (error) {
        console.error(`Error disconnecting transport for server ${serverId} via PUT:`, error);
        return res.status(500).json({ error: 'Failed to disconnect server transport' });
      }
    } else {
      // Connect (or reconnect)
      try {
        // Connect only needs the serverId, manager handles URL/details internally
        await transportManager.connect(serverId); 
        // Re-discover capabilities after reconnecting
        const discoverer = registry.getCapabilityDiscoverer();
        await discoverer.discoverCapabilities(serverId);
        updatedStatus = 'online';
        console.log(`Transport connected and capabilities refreshed for server ${serverId} via PUT`);
      } catch (error) {
        console.error(`Error connecting/discovering for server ${serverId} via PUT:`, error);
        updatedStatus = 'error';
      }
    }
    
    // Update config and respond
    const updatedServers = [...currentConfig.mcpServers];
    updatedServers[serverIndex] = {
      ...serverToUpdate,
      isDisabled,
      status: updatedStatus,
      lastSeen: new Date().toISOString()
    };
    configManager.updateConfig({
      ...currentConfig,
      mcpServers: updatedServers
    });
    const finalStatus = updatedServers[serverIndex].status;
    res.json({ status: finalStatus });
  });

  /**
   * @swagger
   * /api/mcp-servers/{serverId}/dependents:
   *   get:
   *     summary: Get vMCPs that depend on resources from this server
   *     tags: [MCP Servers]
   *     parameters:
   *       - in: path
   *         name: serverId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: List of dependent vMCPs
   *       404:
   *         description: Server not found
   */
  router.get('/mcp-servers/:serverId/dependents', (req, res) => {
    const { serverId } = req.params;
    const configManager = registry.getConfigManager();
    const currentConfig = configManager.getConfig();
    
    // Check if server exists
    const server = currentConfig.mcpServers.find(s => s.name === serverId || s.id === serverId);
    if (!server) {
      return res.status(404).json({ error: `Server ${serverId} not found` });
    }
    
    // Get all vMCPs that use resources from this server
    // This is a simplified implementation - you would need to adjust this based on
    // how your vMCPs track which resources they use from which server
    const dependentVMCPs = currentConfig.vmcps
      .filter(vmcp => {
        // Check if any tools, prompts, or resources in vMCP reference this server
        // This logic depends on how resources are tracked in vMCPs
        return (
          vmcp.tools?.some((toolId: string) => toolId.startsWith(serverId)) ||
          vmcp.prompts?.some((promptId: string) => promptId.startsWith(serverId)) ||
          vmcp.resources?.some((resourceId: string) => resourceId.startsWith(serverId))
        );
      })
      .map(vmcp => {
        // Determine which resource types this vMCP uses from the server
        const usedTools = vmcp.tools?.filter((toolId: string) => toolId.startsWith(serverId)) || [];
        const usedPrompts = vmcp.prompts?.filter((promptId: string) => promptId.startsWith(serverId)) || [];
        const usedResources = vmcp.resources?.filter((resourceId: string) => resourceId.startsWith(serverId)) || [];
        
        const usedTypes = [];
        if (usedTools.length > 0) usedTypes.push(`${usedTools.length} tools`);
        if (usedPrompts.length > 0) usedTypes.push(`${usedPrompts.length} prompts`);
        if (usedResources.length > 0) usedTypes.push(`${usedResources.length} resources`);
        
        return {
          id: vmcp.id,
          name: vmcp.name,
          uses: usedTypes
        };
      });
    
    res.json(dependentVMCPs);
  });

  /**
   * @swagger
   * /api/mcp-servers/{serverId}/tools/execute:
   *   post:
   *     summary: Execute a tool on the MCP server
   *     tags: [MCP Servers]
   *     parameters:
   *       - in: path
   *         name: serverId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               toolName:
   *                 type: string
   *               params:
   *                 type: object
   *     responses:
   *       200:
   *         description: Tool execution result
   *       404:
   *         description: Server or tool not found
   *       500:
   *         description: Execution failed
   */
  router.post('/mcp-servers/:serverId/tools/execute', async (req, res) => {
    try {
      const { serverId } = req.params;
      const { toolName, params } = req.body;

      if (!toolName) {
        return res.status(400).json({ error: 'Tool name is required' });
      }

      // Get the transport manager
      const transportManager = registry.getTransportManager() as unknown as TransportManager;
      
      // Check if this is a vMCP server
      const vmcpManager = registry.getVMCPManager();
      const vmcp = vmcpManager.getVMCP(serverId);
      
      if (vmcp) {
        // This is a vMCP server, use the vMCP instance to execute the tool
        console.log(`Executing tool ${toolName} on vMCP server ${serverId} with arguments:`, params);
        
        // Get the vMCP instance
        const instance = vmcpManager.getVMCPInstance(serverId);
        if (!instance) {
          return res.status(404).json({ error: `vMCP instance ${serverId} not found or not running` });
        }
        
        // Execute the tool using the vMCP instance
        const result = await instance.callTool(toolName, params);
        return res.json({ result });
      }
      
      // Regular MCP server handling
      const transport = transportManager.getTransport(serverId);
      
      if (!transport) {
        return res.status(404).json({ error: `No transport found for server ${serverId}` });
      }
      
      // Check if the server is connected
      const configManager = registry.getConfigManager();
      const config = configManager.getConfig();
      const server = config.mcpServers.find(s => s.name === serverId);
      
      if (!server) {
        return res.status(404).json({ error: `Server ${serverId} not found` });
      }
      
      if (server.isDisabled) {
        return res.status(400).json({ error: `Server ${serverId} is disconnected` });
      }
      
      // Check if the tool exists
      const capabilityRegistry = registry.getCapabilityRegistry();
      const toolsForServer = capabilityRegistry.getToolsForServer(serverId);
      const tool = toolsForServer.find(t => t.name === toolName);
      
      if (!tool) {
        return res.status(404).json({ error: `Tool '${toolName}' not found for server ${serverId}` });
      }
      
      // Construct the tool execution request
      console.log(`Executing tool ${toolName} on server ${serverId} with arguments:`, params);
      
      // Send the request
      // Ensure the ID is a string for the request method type
      const requestId = `tool-execution-${Date.now()}`;
      const toolExecutionRequest = {
        jsonrpc: '2.0' as const,
        id: requestId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: params
        }
      };
      
      // Type assertion needed because SDK types might not perfectly match TransportManager expectation
      const rawResponse = await transportManager.request(serverId, toolExecutionRequest as JSONRPCMessage & { id: string });
      const response = rawResponse as JSONRPCResponse; // Assert the type here
      
      // The request method throws on error or invalid response structure (no ID match), 
      // so we can assume response is a valid JSONRPCResponse here if it resolves.
      // Check for the result property existence which is guaranteed by JSONRPCResponse type.
      if (!response.result) { 
        console.error('Valid JSONRPCResponse received, but missing result property:', response);
        // This case indicates a server logic error or incorrect JSONRPCResponse typing
        throw new Error('Server returned a valid response structure but without a result.');
      }
      
      res.json({
        result: response.result // Now safe to access result
      });
      
    } catch (error) {
      console.error('Tool execution failed:', error);
      res.status(500).json({ 
        error: 'Failed to execute tool',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * @swagger
   * /api/vmcp-servers/{id}/dependents:
   *   get:
   *     summary: Get servers that are used by this vMCP
   *     tags: [vMCP Instances]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: List of source servers
   *       404:
   *         description: vMCP not found
   */
  router.get('/vmcp-servers/:id/dependents', (req, res) => {
    try {
      const { id } = req.params;
      const vmcpManager = registry.getVMCPManager();
      const vmcpDefinition = vmcpManager.getVMCP(id);
      
      if (!vmcpDefinition) {
        return res.status(404).json({ error: `vMCP with id ${id} not found` });
      }
      
      // Return the list of source servers this vMCP depends on
      const sourceServers = vmcpDefinition.sourceServerIds.map(serverId => {
        return {
          id: serverId,
          name: serverId, // Use serverId as name if actual name not available
          type: 'source_server'
        };
      });
      
      res.json(sourceServers);
    } catch (error) {
      console.error(`Error getting vMCP ${req.params.id} dependents:`, error);
      res.status(500).json({ 
        error: 'Failed to get vMCP source servers',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * @swagger
   * /api/vmcp-servers/{id}/capabilities:
   *   get:
   *     summary: Get capabilities for a specific vMCP instance
   *     tags: [vMCP Instances]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The ID of the vMCP instance
   *     responses:
   *       200:
   *         description: The capabilities of the vMCP instance
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tools: 
   *                   type: array
   *                   items: { $ref: '#/components/schemas/ToolDefinition' }
   *                 prompts:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/Prompt' }
   *                 resources:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/Resource' }
   *       404:
   *         description: vMCP instance not found or not running
   *       500:
   *         description: Internal server error
   */
  router.get('/vmcp-servers/:id/capabilities', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      // First check if the definition exists
      const definition = vmcpManager.getVMCP(id);
      if (!definition) {
        return res.status(404).json({ error: `vMCP instance with ID '${id}' not found.` });
      }

      // Then check if it's running
      if (definition.status !== 'running') {
        return res.status(404).json({ error: `vMCP instance with ID '${id}' is defined but not currently running.` });
      }

      // Access the private runningInstances map to get the instance
      // @ts-ignore - Accessing private member for now
      const instance: VMCPInstance | undefined = vmcpManager['runningInstances']?.get(id);

      if (!instance) {
        // This should never happen if status is 'running', but handle it just in case
        return res.status(500).json({ error: `vMCP instance with ID '${id}' is marked as running but instance not found.` });
      }

      // Return the aggregated capabilities directly from the instance's private fields
      // @ts-ignore - Accessing private members for now
      const capabilities = {
        tools: instance['aggregatedTools'] || [],
        prompts: instance['aggregatedPrompts'] || [],
        resources: instance['aggregatedResources'] || []
      };
      res.json(capabilities);

    } catch (error) {
      console.error(`Error fetching capabilities for vMCP instance ${id}:`, error);
      res.status(500).json({ error: 'Failed to fetch capabilities', details: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * @swagger
   * /api/vmcp-servers/{id}/connection:
   *   put:
   *     summary: Start or stop a vMCP instance
   *     tags: [vMCP Instances]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               isDisabled:
   *                 type: boolean
   *                 description: Whether the vMCP should be stopped (true) or started (false)
   *     responses:
   *       200:
   *         description: vMCP status updated
   *       404:
   *         description: vMCP not found
   *       500:
   *         description: Failed to start/stop vMCP
   */
  router.put('/vmcp-servers/:id/connection', async (req, res) => {
    try {
      const { id } = req.params;
      const { isDisabled } = req.body;
      const vmcpManager = registry.getVMCPManager();
      const vmcpDefinition = vmcpManager.getVMCP(id);
      
      if (!vmcpDefinition) {
        return res.status(404).json({ error: `vMCP with id ${id} not found` });
      }
      
      if (isDisabled) {
        // Stop the vMCP
        await vmcpManager.stopVMCP(id);
        const updatedDefinition = vmcpManager.getVMCP(id);
        return res.json({ 
          status: updatedDefinition?.status || 'stopped',
          message: 'vMCP stopped successfully'
        });
      } else {
        // Start the vMCP
        await vmcpManager.startVMCP(id);
        const updatedDefinition = vmcpManager.getVMCP(id);
        return res.json({ 
          status: updatedDefinition?.status || 'running',
          message: 'vMCP started successfully'
        });
      }
    } catch (error) {
      console.error(`Error toggling vMCP ${req.params.id} connection:`, error);
      return res.status(500).json({ 
        error: 'Failed to change vMCP connection state',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  router.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
  });

  app.use('/api', router);
} 