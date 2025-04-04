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
  
  // Parse CLI arguments and environment variables
  const { env, args } = parseArgs();
  const envVars = parseEnvVars();
  
  // Load configuration
  const fileConfig = await ConfigLoader.loadFromFile(join(__dirname, './config/default.json'));
  const envConfig = await ConfigLoader.loadFromEnv();
  
  // Merge all configurations
  const finalConfig = {
    ...fileConfig,
    ...envConfig,
    ...envVars,
    env,
    args
  };
  
  registry.getConfigManager().updateConfig(finalConfig);

  // Initialize connections for existing servers in config
  const initialConfig = configManager.getConfig();
  if (initialConfig.mcpServers && initialConfig.mcpServers.length > 0) {
    console.log(`Initializing connections for ${initialConfig.mcpServers.length} pre-configured servers...`);
    const setupPromises = initialConfig.mcpServers.map(async (server) => {
      if (!server || !server.name || !server.url) {
        console.warn('Skipping invalid server config entry:', server);
        return;
      }
      
      if (server.isDisabled) {
         console.log(`Server ${server.name} is disabled, skipping initial connection.`);
         return;
      }

      try {
        console.log(`Setting up transport for ${server.name} at ${server.url}`);
        // 1. Create transport instance
        const transport = new SSETransport(`${server.url}/sse`, {
          'Accept': 'text/event-stream',
          'Connection': 'keep-alive'
        }, {
          // Add options if TransportManager doesn't handle them
          maxRetries: 3, 
          retryDelay: 1000,
          timeout: 30000
        });
        
        // 2. Add transport to the manager
        transportManager.addTransport(server.name, transport);

        // 3. Connect using the manager (which calls transport.start)
        await transportManager.connect(server.name);
        console.log(`Initial connection successful for ${server.name}. Discovering capabilities...`);

        // Attach handlers *after* connection, if needed for this logic
        transport.onerror = (error: Error) => { 
          console.error(`Initial transport error for ${server.name}:`, error);
          // Update status to error
          const currentConfig = configManager.getConfig();
          const updatedServers = currentConfig.mcpServers.map(s => 
            s.name === server.name ? { ...s, status: 'error' as const, lastSeen: new Date().toISOString() } : s
          );
          configManager.updateConfig({ ...currentConfig, mcpServers: updatedServers });
        };
        transport.onclose = () => {
          console.log(`Initial transport closed for ${server.name}`);
          // Update status to offline
          const currentConfig = configManager.getConfig();
          const updatedServers = currentConfig.mcpServers.map(s => 
            s.name === server.name ? { ...s, status: 'offline' as const, lastSeen: new Date().toISOString() } : s
          );
          configManager.updateConfig({ ...currentConfig, mcpServers: updatedServers });
        };

        await discoverer.discoverCapabilities(server.name);
        console.log(`Initial capabilities discovered for ${server.name}.`);
        
        // Update status in config
        const currentConfig = configManager.getConfig();
        const updatedServers = currentConfig.mcpServers.map(s => 
          s.name === server.name ? { ...s, status: 'online' as const, lastSeen: new Date().toISOString() } : s
        );
        configManager.updateConfig({ ...currentConfig, mcpServers: updatedServers });

      } catch (error) {
        console.error(`Failed initial setup for server ${server.name}:`, error);
        // Update status to 'error' in config if server exists
        const currentConfig = configManager.getConfig();
        const serverExists = currentConfig.mcpServers.some(s => s.name === server.name);
        if (serverExists) {
            const updatedServers = currentConfig.mcpServers.map(s => 
              s.name === server.name ? { ...s, status: 'error' as const, lastSeen: new Date().toISOString() } : s
            );
            configManager.updateConfig({ ...currentConfig, mcpServers: updatedServers });
        }
      }
    });
    await Promise.all(setupPromises);
    console.log('Initial server setup attempts complete.');
  }

  // Enable CORS
  app.use(cors());

  // Parse JSON bodies
  app.use(express.json());

  // Setup routes before Swagger UI
  setupRoutes(app);

  // Setup Swagger
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

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Swagger docs available at http://localhost:${port}/api-docs`);
    if (env) console.log(`Environment: ${env}`);
    if (args?.length) console.log(`Additional arguments: ${args.join(' ')}`);
  });
}

main().catch(console.error); 