import express from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUiExpress from 'swagger-ui-express';
import { ServiceRegistry } from './services/registry.js';
import { setupRoutes } from './api/routes.js';
import { ConfigLoader } from './config/loader.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

  app.use(express.json());

  setupRoutes(app);

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Swagger docs available at http://localhost:${port}/api-docs`);
    if (env) console.log(`Environment: ${env}`);
    if (args?.length) console.log(`Additional arguments: ${args.join(' ')}`);
  });
}

main().catch(console.error); 