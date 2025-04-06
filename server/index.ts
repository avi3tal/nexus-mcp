import express from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUiExpress from 'swagger-ui-express';
import { ServiceRegistry } from './services/registry.js';
import { setupRoutes } from './api/routes.js';
import { ConfigLoader } from './config/loader.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import { SSETransport } from './transport/SSETransport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const config: { env?: string; args?: string[] } = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--env' && i + 1 < args.length) {
      config.env = args[++i];
    } else if (arg.startsWith('--args=')) {
      config.args = arg.slice(7).split(' ');
    }
  }
  
  return config;
}

function parseEnvVars() {
  try {
    const envVars = process.env.MCP_ENV_VARS;
    return envVars ? JSON.parse(envVars) : {};
  } catch {
    return {};
  }
}

async function main() {
  const app = express();
  const registry = ServiceRegistry.getInstance();
  const configManager = registry.getConfigManager();
  const transportManager = registry.getTransportManager();
  const discoverer = registry.getCapabilityDiscoverer();
  
  // --- Config Loading --- 
  const { env, args } = parseArgs();
  const envVars = parseEnvVars();
  const fileConfig = await ConfigLoader.loadFromFile(join(__dirname, './config/default.json'));
  const envConfig = await ConfigLoader.loadFromEnv();
  const loadedConfig = { // Merge config sources
    ...fileConfig,
    ...envConfig,
    ...envVars,
    env,
    args
  };

  // **** IMPORTANT: Update ConfigManager state synchronously FIRST ****
  console.log('Updating ConfigManager with loaded config...');
  configManager.updateConfig(loadedConfig); 
  console.log('ConfigManager updated.');

  // --- Start Background Server Initialization ---
  // Get the config *from the manager* now
  const currentConfigForInit = configManager.getConfig(); 
  if (currentConfigForInit.mcpServers && currentConfigForInit.mcpServers.length > 0) {
    console.log(`Starting background initialization for ${currentConfigForInit.mcpServers.length} servers...`);
    // Use map to kick off all initializations, but DO NOT await Promise.all here
    currentConfigForInit.mcpServers.forEach(async (server) => { 
      if (!server || !server.name || !server.url) {
        console.warn('Skipping invalid server config entry:', server);
        return;
      }
      if (server.isDisabled) {
         console.log(`Server ${server.name} is disabled, skipping initial connection.`);
         return;
      }
      try {
        console.log(`Background: Setting up transport for ${server.name}`);
        const transport = new SSETransport(`${server.url}/sse`, {
          'Accept': 'text/event-stream', 'Connection': 'keep-alive'
        }, { maxRetries: 3, retryDelay: 1000, timeout: 30000 });
        
        const serverId = server.id || server.name;
        transportManager.addTransport(serverId, transport);
        await transportManager.connect(serverId);
        console.log(`Background: Connected ${server.name}. Discovering...`);

        transport.onerror = (error: Error) => { 
          console.error(`Background transport error for ${server.name}:`, error);
          const cfg = configManager.getConfig();
          configManager.updateConfig({ ...cfg, mcpServers: cfg.mcpServers.map(s => s.name === server.name ? { ...s, status: 'error' as const, lastSeen: new Date().toISOString() } : s) });
        };
        transport.onclose = () => {
          console.log(`Background transport closed for ${server.name}`);
          const cfg = configManager.getConfig();
          configManager.updateConfig({ ...cfg, mcpServers: cfg.mcpServers.map(s => s.name === server.name ? { ...s, status: 'offline' as const, lastSeen: new Date().toISOString() } : s) });
        };

        await discoverer.discoverCapabilities(serverId);
        console.log(`Background: Discovered capabilities for ${server.name}`);
        
        // Update status in config
        const cfg = configManager.getConfig();
        configManager.updateConfig({ ...cfg, mcpServers: cfg.mcpServers.map(s => s.name === server.name ? { ...s, status: 'online' as const, lastSeen: new Date().toISOString() } : s) });

      } catch (error) {
        console.error(`Background: Failed initial setup for server ${server.name}:`, error);
        const cfg = configManager.getConfig();
        // Only update status if server definition still exists
        if (cfg.mcpServers.some(s => s.name === server.name)) {
             configManager.updateConfig({ ...cfg, mcpServers: cfg.mcpServers.map(s => s.name === server.name ? { ...s, status: 'error' as const, lastSeen: new Date().toISOString() } : s) });
        }
      }
    });
    console.log('Background server initializations kicked off.');
  } else {
      console.log('No pre-configured MCP servers found to initialize.');
  }

  // --- Initialize VMCPs (can happen after synchronous config update) ---
  console.log('Initializing VMCP Manager...');
  const vmcpManager = registry.getVMCPManager();

  // Initialize vMCP instances in the background
  const vmcpDefinitions = vmcpManager.listVMCPs();
  vmcpDefinitions.forEach(async (definition) => {
    try {
      console.log(`Starting vMCP instance ${definition.id} (${definition.name})...`);
      await vmcpManager.startVMCP(definition.id);
      console.log(`vMCP instance ${definition.id} started successfully on port ${definition.port}`);
    } catch (error) {
      console.error(`Failed to start vMCP instance ${definition.id}:`, error);
    }
  });

  // --- Setup Middleware, Routes, Listener (Proceed Immediately) ---
  console.log('Setting up middleware...');
  app.use(cors());
  app.use(express.json());

  console.log('Setting up API routes...');
  setupRoutes(app);

  console.log('Setting up Swagger...');
  const swaggerOptions = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Nexus MCP Platform API',
        version: '1.0.0',
        description: 'API for managing MCP servers and vMCP instances',
      },
      servers: [
        {
          url: `http://localhost:${process.env.PORT || 3000}`,
          description: 'Development server',
        },
      ],
      components: {
        schemas: {
          MCPServer: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the MCP server'
              },
              url: {
                type: 'string',
                description: 'URL of the MCP server'
              },
              transport: {
                type: 'string',
                description: 'Transport type (e.g., http, stdio)'
              },
              auth: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    description: 'Authentication type'
                  },
                  config: {
                    type: 'object',
                    description: 'Authentication configuration'
                  }
                }
              },
              capabilities: {
                type: 'object',
                properties: {
                  tools: {
                    type: 'object',
                    description: 'Available tools in this MCP server'
                  },
                  prompts: {
                    type: 'object',
                    description: 'Available prompts in this MCP server'
                  },
                  resources: {
                    type: 'object',
                    description: 'Available resources in this MCP server'
                  }
                }
              }
            },
            required: ['name', 'url', 'transport']
          },
          vMCPInstance: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique identifier for the vMCP instance'
              },
              name: {
                type: 'string',
                description: 'Name of the vMCP instance'
              },
              server: {
                type: 'string',
                description: 'Name of the MCP server this instance belongs to'
              },
              capabilities: {
                type: 'object',
                properties: {
                  tools: {
                    type: 'array',
                    items: {
                      type: 'string'
                    },
                    description: 'List of tools available in this vMCP instance'
                  },
                  prompts: {
                    type: 'array',
                    items: {
                      type: 'string'
                    },
                    description: 'List of prompts available in this vMCP instance'
                  },
                  resources: {
                    type: 'array',
                    items: {
                      type: 'string'
                    },
                    description: 'List of resources available in this vMCP instance'
                  }
                }
              },
              config: {
                type: 'object',
                description: 'Configuration specific to this vMCP instance'
              }
            },
            required: ['id', 'name', 'server']
          },
          Tool: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the tool'
              },
              description: {
                type: 'string',
                description: 'Description of what the tool does'
              },
              parameters: {
                type: 'object',
                description: 'Tool parameters schema',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['object']
                  },
                  properties: {
                    type: 'object',
                    additionalProperties: true
                  },
                  required: {
                    type: 'array',
                    items: {
                      type: 'string'
                    }
                  }
                }
              },
              inputSchema: {
                type: 'object',
                description: 'Tool input schema',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['object']
                  },
                  properties: {
                    type: 'object',
                    additionalProperties: true
                  },
                  required: {
                    type: 'array',
                    items: {
                      type: 'string'
                    }
                  }
                }
              }
            },
            required: ['name', 'parameters', 'inputSchema']
          },
          Prompt: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the prompt'
              },
              description: {
                type: 'string',
                description: 'Description of the prompt'
              },
              template: {
                type: 'string',
                description: 'Prompt template with placeholders'
              },
              arguments: {
                type: 'array',
                description: 'List of arguments that can be used in the template',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Name of the argument'
                    },
                    description: {
                      type: 'string',
                      description: 'Description of the argument'
                    },
                    required: {
                      type: 'boolean',
                      description: 'Whether the argument is required'
                    }
                  },
                  required: ['name']
                }
              }
            },
            required: ['name', 'template']
          },
          UnderlyingServerStatus: {
            type: 'object',
            properties: {
              serverId: { type: 'string' },
              status: { type: 'string', enum: ['connecting', 'connected', 'error', 'disconnected'] },
              lastError: { type: 'string', nullable: true }
            }
          },
          VMCPAggregationRule: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['aggregate_all'] }
            },
            required: ['type']
          },
          VMCPDefinition: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid', readOnly: true },
              name: { type: 'string' },
              port: { type: 'integer' },
              sourceServerIds: { type: 'array', items: { type: 'string' } },
              aggregationRules: { type: 'array', items: { '$ref': '#/components/schemas/VMCPAggregationRule' } },
              status: { type: 'string', enum: ['stopped', 'starting', 'running', 'error', 'partially_degraded'], readOnly: true },
              underlyingServersStatus: { type: 'array', items: { '$ref': '#/components/schemas/UnderlyingServerStatus' }, readOnly: true },
              createdAt: { type: 'string', format: 'date-time', readOnly: true },
              updatedAt: { type: 'string', format: 'date-time', readOnly: true }
            },
            required: ['id', 'name', 'port', 'sourceServerIds', 'aggregationRules', 'status', 'underlyingServersStatus', 'createdAt', 'updatedAt']
          },
          NewVMCPDefinition: {
            type: 'object',
            description: 'Data required to create a new vMCP definition',
            properties: {
              name: { type: 'string' },
              port: { type: 'integer' },
              sourceServerIds: { type: 'array', items: { type: 'string' } },
              aggregationRules: { type: 'array', items: { '$ref': '#/components/schemas/VMCPAggregationRule' } }
            },
            required: ['name', 'port', 'sourceServerIds', 'aggregationRules']
          }
        }
      }
    },
    apis: [join(__dirname, 'api/routes.js')],
  };

  const specs = swaggerJsdoc(swaggerOptions);
  app.use('/api-docs', swaggerUiExpress.serve, swaggerUiExpress.setup(specs));

  // Error handling middleware
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
  });

  console.log('Starting server listener...');
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Swagger docs available at http://localhost:${port}/api-docs`);
    if (env) console.log(`Environment: ${env}`);
    if (args?.length) console.log(`Additional arguments: ${args.join(' ')}`);
  });
}

main().catch(console.error); 