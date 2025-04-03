import { ServiceRegistry } from '../services/registry.js';
import { SSETransport } from '../transport/SSETransport.js';
import { MCPServerConfig } from '../config/types.js';
import { CapabilityError } from '../capabilities/errors.js';
import { ConfigManager } from '../config/manager.js';
import { TransportManager } from '../transport/manager.js';
import { CapabilityDiscoverer } from '../capabilities/discoverer.js';
import { CapabilityRegistry } from '../capabilities/registry.js';
import { CapabilityRefreshManager } from '../capabilities/refresh.js';

async function addServer() {
  console.log('Adding MCP server...');
  
  try {
    // Initialize services
    const serviceRegistry = ServiceRegistry.getInstance();
    const configManager = new ConfigManager();
    const transportManager = new TransportManager();
    const capabilityRegistry = new CapabilityRegistry();
    const capabilityDiscoverer = new CapabilityDiscoverer(transportManager, capabilityRegistry);
    const capabilityRefreshManager = new CapabilityRefreshManager(capabilityDiscoverer);

    // Register services
    serviceRegistry.register('configManager', configManager);
    serviceRegistry.register('transportManager', transportManager);
    serviceRegistry.register('capabilityRegistry', capabilityRegistry);
    serviceRegistry.register('capabilityDiscoverer', capabilityDiscoverer);
    serviceRegistry.register('capabilityRefreshManager', capabilityRefreshManager);
    
    // Create server configuration
    const serverConfig: MCPServerConfig = {
      name: 'test-server',
      url: 'http://localhost:3001/sse',
      transport: 'sse'
    };
    
    // Update current configuration
    const currentConfig = configManager.getConfig();
    currentConfig.mcpServers = [serverConfig];
    configManager.updateConfig(currentConfig);
    
    // Create and setup SSE transport
    const transport = new SSETransport(serverConfig.url, {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    });
    
    // Register transport with the transport manager
    transportManager.addTransport(serverConfig.name, transport);
    
    // Setup message handler
    transport.onmessage = (message) => {
      console.log('Received message:', message);
    };
    
    // Setup error handler
    transport.onerror = (error) => {
      console.error('Transport error:', error);
    };
    
    // Setup close handler
    transport.onclose = () => {
      console.log('Transport closed');
    };
    
    console.log('Connecting to server...');
    await transportManager.connect(serverConfig.name);
    console.log('Connected successfully');
    
    console.log('Discovering capabilities...');
    const capabilities = await capabilityDiscoverer.discoverCapabilities(serverConfig.name);
    console.log('Capabilities discovered:', capabilities);
    
    // Cleanup
    await transportManager.disconnect(serverConfig.name);
    transportManager.removeTransport(serverConfig.name);
    
    console.log('Server added successfully');
  } catch (error) {
    if (error instanceof CapabilityError) {
      console.error('Failed to add server:', error);
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

addServer(); 