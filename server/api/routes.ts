import express, { Request, Response } from 'express';
import { ServiceRegistry } from '../services/registry.js';
import { MCPServerConfig, vMCPConfig } from '../config/types.js';
import { CapabilityError } from '../capabilities/errors.js';
import { SSETransport } from '../transport/SSETransport.js';

export function setupRoutes(app: express.Application): void {
  const router = express.Router();
  const registry = ServiceRegistry.getInstance();

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
    const config = registry.getConfigManager().getConfig();
    res.json(config.mcpServers);
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
      const transportManager = registry.getTransportManager();
      const discoverer = registry.getCapabilityDiscoverer();
      
      // Update config first
      const currentConfig = configManager.getConfig();
      configManager.updateConfig({
        mcpServers: [...currentConfig.mcpServers, serverConfig]
      });
      
      // Try to connect transport and discover capabilities
      try {
        const transport = new SSETransport(`${serverConfig.url}/sse`, {
          'Accept': 'text/event-stream',
          'Connection': 'keep-alive'
        }, {
          maxRetries: 3,
          retryDelay: 1000,
          timeout: 30000
        });

        // Handle transport errors
        transport.onerror = (error: Error) => {
          console.error('Transport error:', error);
          res.status(500).json({ error: error.message });
        };

        // Handle transport close
        transport.onclose = () => {
          console.log(`Transport closed for server ${serverConfig.name}`);
        };

        transportManager.addTransport(serverConfig.name, transport);
        await transportManager.connect(serverConfig.name);
        await discoverer.discoverCapabilities(serverConfig.name);
        
        res.status(201).json(serverConfig);
      } catch (error) {
        console.error(`Failed to connect to server ${serverConfig.name}:`, error);
        res.status(500).json({ 
          error: 'Failed to connect to server',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    } catch (error) {
      console.error('Failed to add server:', error);
      res.status(500).json({ 
        error: 'Failed to add server',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * @swagger
   * /api/vmcps:
   *   get:
   *     summary: List all vMCP instances
   *     tags: [vMCP Instances]
   *     responses:
   *       200:
   *         description: List of vMCP instances
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/vMCPInstance'
   */
  router.get('/vmcps', (req, res) => {
    const config = registry.getConfigManager().getConfig();
    res.json(config.vmcps);
  });

  /**
   * @swagger
   * /api/vmcps:
   *   post:
   *     summary: Create a new vMCP instance
   *     tags: [vMCP Instances]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/vMCPInstance'
   *     responses:
   *       201:
   *         description: vMCP instance created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/vMCPInstance'
   *       400:
   *         description: Invalid input
   */
  router.post('/vmcps', (req, res) => {
    const vmcpConfig = req.body as vMCPConfig;
    const configManager = registry.getConfigManager();
    const currentConfig = configManager.getConfig();
    
    configManager.updateConfig({
      vmcps: [...currentConfig.vmcps, vmcpConfig]
    });
    
    res.status(201).json(vmcpConfig);
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
      const discoverer = registry.getCapabilityDiscoverer();
      await discoverer.discoverCapabilities(serverId);
      
      const capabilityRegistry = registry.getCapabilityRegistry();
      res.json({
        tools: capabilityRegistry.getAllTools(),
        prompts: capabilityRegistry.getAllPrompts()
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
        status: 'connected',
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
  router.delete('/mcp-servers/:serverId', (req, res) => {
    const { serverId } = req.params;
    const configManager = registry.getConfigManager();
    const currentConfig = configManager.getConfig();
    
    const serverIndex = currentConfig.mcpServers.findIndex(s => s.name === serverId);
    if (serverIndex === -1) {
      res.status(404).json({ error: `Server ${serverId} not found` });
      return;
    }
    
    const updatedServers = [...currentConfig.mcpServers];
    updatedServers.splice(serverIndex, 1);
    
    configManager.updateConfig({
      mcpServers: updatedServers
    });
    
    res.status(204).send();
  });

  router.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
  });

  app.use('/api', router);
} 