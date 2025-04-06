import { Server } from "@modelcontextprotocol/sdk/server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { JSONRPCMessage, JSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";
import { VMCPDefinition } from "./types.js";
import { VMCPManager } from "./manager.js";
import { VMCPInstance } from "./instance.js";
import { TransportManager } from "../transport/manager.js";
import express from 'express';
import http from 'http';

// Define request schemas based on MCP protocol
const ListResourcesRequestSchema = { method: "list_resources" };
const ReadResourceRequestSchema = { method: "read_resource" };
const ListToolsRequestSchema = { method: "list_tools" };
const CallToolRequestSchema = { method: "call_tool" };
const ListPromptsRequestSchema = { method: "list_prompts" };
const GetPromptRequestSchema = { method: "get_prompt" };
const GetResourceRequestSchema = { method: "get_resource" };

// Define response types
interface Resource {
  uri: string;
  name: string;
  type: string;
}

interface Tool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

interface Prompt {
  name: string;
  description?: string;
  argsSchema?: Record<string, any>;
}

export class VMCPServer {
  private server: Server;
  private manager: VMCPManager;
  private instance: VMCPInstance;
  private transportManager: TransportManager;
  private expressApp: express.Application;
  private httpServer: http.Server | null = null;
  
  constructor(serverId: string, manager: VMCPManager) {
    this.manager = manager;
    const definition = manager.getVMCP(serverId);
    if (!definition) {
      throw new Error(`vMCP server with ID ${serverId} not found`);
    }
    
    // Create a new instance
    this.transportManager = manager.getTransportManager();
    this.instance = new VMCPInstance(definition, this.transportManager);
    
    // Initialize the MCP server
    this.server = new Server({
      name: this.instance.definition.name,
      version: "1.0.0"
    }, {
      capabilities: {
        resources: { list: true, get: true },
        tools: { list: true, call: true },
        prompts: { list: true, get: true }
      }
    });
    
    // Set up handlers
    this.setupResourceHandlers();
    this.setupToolHandlers();
    this.setupPromptHandlers();
    
    // Initialize Express app
    this.expressApp = express();
    this.setupExpressRoutes();
  }
  
  private setupResourceHandlers() {
    // List resources handler
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = await this.instance.listResources();
      return { resources };
    });
    
    // Get resource handler
    this.server.setRequestHandler(GetResourceRequestSchema, async (request: any) => {
      const { uri } = request.params;
      const resource = await this.instance.getResource(uri);
      if (!resource) {
        throw new Error(`Resource ${uri} not found`);
      }
      return resource;
    });
  }
  
  private setupToolHandlers() {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.instance.listTools();
      return { tools };
    });
    
    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;
      const result = await this.instance.callTool(name, args);
      if (!result) {
        throw new Error(`Tool ${name} not found`);
      }
      return result;
    });
  }
  
  private setupPromptHandlers() {
    // List prompts handler
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = await this.instance.listPrompts();
      return { prompts };
    });
    
    // Get prompt handler
    this.server.setRequestHandler(GetPromptRequestSchema, async (request: any) => {
      const { name } = request.params;
      const prompt = await this.instance.getPrompt(name);
      if (!prompt) {
        throw new Error(`Prompt ${name} not found`);
      }
      return prompt;
    });
  }
  
  private setupExpressRoutes() {
    // SSE endpoint for MCP connections
    this.expressApp.get("/sse", async (req, res) => {
      try {
        // Set SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        // Create SSE transport
        const transport = new SSEServerTransport("/message", res);
        
        // Set up error handling
        res.on('close', () => {
          console.log(`Client disconnected from vMCP server ${this.instance.definition.id}`);
        });
        
        // Connect the MCP server to this transport
        await this.server.connect(transport);
        
        // Send connection confirmation
        res.write(`data: ${JSON.stringify({ 
          jsonrpc: '2.0', 
          method: 'connected', 
          params: { 
            status: 'connected',
            serverId: this.instance.definition.id
          } 
        })}\n\n`);
        
      } catch (error) {
        console.error(`Error setting up SSE connection:`, error);
        if (!res.headersSent) {
          res.status(500).send('Error setting up connection');
        }
      }
    });

    // Capabilities endpoint
    this.expressApp.get("/capabilities", async (req, res) => {
      try {
        const capabilities = {
          tools: await this.instance.listTools(),
          prompts: await this.instance.listPrompts(),
          resources: await this.instance.listResources()
        };
        res.json(capabilities);
      } catch (error) {
        console.error(`Error fetching capabilities:`, error);
        res.status(500).json({ 
          error: 'Failed to fetch capabilities', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });
  }
  
  async start() {
    // Start the HTTP server
    const port = this.instance.definition.port;
    this.httpServer = this.expressApp.listen(port, () => {
      console.log(`vMCP server started on port ${port}`);
    });
  }
  
  async stop() {
    // Stop the HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer?.close(() => {
          console.log(`vMCP server stopped`);
          resolve();
        });
      });
      this.httpServer = null;
    }
    
    // Stop the MCP server
    if (this.server && typeof this.server.close === 'function') {
      await this.server.close();
    }
  }
  
  async checkHealth() {
    // Check health of underlying servers
    const health = await this.instance.checkHealth();
    return health;
  }
} 