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

async function main() {
  const app = express();
  const registry = ServiceRegistry.getInstance();
  
  // Load configuration
  const fileConfig = await ConfigLoader.loadFromFile(join(__dirname, '../config/default.json'));
  const envConfig = await ConfigLoader.loadFromEnv();
  registry.getConfigManager().updateConfig({ ...fileConfig, ...envConfig });

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
          url: 'http://localhost:3000',
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
          }
        }
      }
    },
    apis: ['./src/api/routes.ts'],
  };

  const specs = swaggerJsdoc(swaggerOptions);
  app.use('/api-docs', swaggerUiExpress.serve, swaggerUiExpress.setup(specs));

  app.use(express.json());

  setupRoutes(app);

  const port = registry.getConfigManager().getConfig().port;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Swagger docs available at http://localhost:${port}/api-docs`);
  });
}

main().catch(console.error); 