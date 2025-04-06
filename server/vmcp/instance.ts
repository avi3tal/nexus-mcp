import { Server } from '@modelcontextprotocol/sdk/server';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import * as http from 'http';
import * as url from 'url';
import { VMCPDefinition } from './types.js';
import { TransportManager } from '../transport/manager.js';
import { SSETransport } from '../transport/SSETransport.js';
import type { JSONRPCMessage, JSONRPCResponse, JSONRPCRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod'; // Assuming zod is available for schema definition

// Define types manually based on protocol spec if not exported

// Basic Tool structure
interface Tool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>; // Simplified - use JSONSchema if needed
}

// Basic Prompt structure
interface Prompt {
  name: string;
  description?: string;
  arguments?: any[]; // Simplified
}

// Basic Resource structure
interface Resource {
  uri: string;
  name?: string;
  mimeType?: string;
  // ... other potential fields
}

// Basic Error structure (adapt ErrorCode values if known)
enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  // Add custom codes if needed, e.g., ServerError = -32000
}

class McpError extends Error {
  code: ErrorCode;
  data?: any;

  constructor(code: ErrorCode, message: string, data?: any) {
    super(message);
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, McpError.prototype);
  }
}

// --- Define Basic Request Schemas --- 
// Using Zod, assuming it's installed. Adjust if using a different schema library.

const BaseRequestSchema = z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
});

const ListToolsRequestSchema = BaseRequestSchema.extend({
    method: z.literal('tools/list'),
    params: z.undefined().optional() // No params expected for list
});

const CallToolRequestSchema = BaseRequestSchema.extend({
    method: z.literal('tools/call'),
    params: z.object({
        name: z.string(),
        arguments: z.any().optional() // Use z.any() for simplicity, or specific schema if known
    })
});

const ListPromptsRequestSchema = BaseRequestSchema.extend({
    method: z.literal('prompts/list'),
     params: z.undefined().optional()
});

const GetPromptRequestSchema = BaseRequestSchema.extend({
    method: z.literal('prompts/get'),
    params: z.object({
        name: z.string(),
        arguments: z.any().optional()
    })
});

const ListResourcesRequestSchema = BaseRequestSchema.extend({
    method: z.literal('resources/list'),
     params: z.undefined().optional()
});

const GetResourceRequestSchema = BaseRequestSchema.extend({
    method: z.literal('resources/get'),
    params: z.object({
        uri: z.string()
    })
});

export class VMCPInstance {
    private mcpServer: Server | null = null;
    private httpServer: http.Server | null = null;
    private activeClientTransports: Map<string, SSEServerTransport> = new Map();
    private aggregatedTools: Tool[] = [];
    private aggregatedPrompts: Prompt[] = [];
    private aggregatedResources: Resource[] = [];
    private capabilityMap: Map<string, string> = new Map(); 

    constructor(
        public readonly definition: VMCPDefinition,
        private transportManager: TransportManager
    ) {}

    // Public methods for capability management
    async listResources(): Promise<Resource[]> {
        await this.aggregateCapabilities();
        return this.aggregatedResources;
    }

    async getResource(uri: string): Promise<Resource | null> {
        await this.aggregateCapabilities();
        const resource = this.aggregatedResources.find(r => r.uri === uri);
        if (!resource) return null;

        const sourceServerId = this.capabilityMap.get(uri);
        if (!sourceServerId) return null;

        try {
            const response = await this.transportManager.request(sourceServerId, {
                jsonrpc: '2.0',
                id: `vmcp-${this.definition.id}-resource-${Date.now()}`,
                method: 'resources/get',
                params: { uri }
            });
            return response.result;
        } catch (error) {
            console.error(`Error fetching resource ${uri} from ${sourceServerId}:`, error);
            return null;
        }
    }

    async listTools(): Promise<Tool[]> {
        await this.aggregateCapabilities();
        return this.aggregatedTools;
    }

    async callTool(name: string, args: any): Promise<any> {
        await this.aggregateCapabilities();
        const sourceServerId = this.capabilityMap.get(name);
        if (!sourceServerId) {
            throw new Error(`Tool ${name} not found`);
        }

        try {
            const response = await this.transportManager.request(sourceServerId, {
                jsonrpc: '2.0',
                id: `vmcp-${this.definition.id}-tool-${Date.now()}`,
                method: 'tools/call',
                params: { name, arguments: args }
            });
            return response.result;
        } catch (error) {
            console.error(`Error calling tool ${name} on ${sourceServerId}:`, error);
            throw error;
        }
    }

    async listPrompts(): Promise<Prompt[]> {
        await this.aggregateCapabilities();
        return this.aggregatedPrompts;
    }

    async getPrompt(name: string): Promise<Prompt | null> {
        await this.aggregateCapabilities();
        const prompt = this.aggregatedPrompts.find(p => p.name === name);
        if (!prompt) return null;

        const sourceServerId = this.capabilityMap.get(name);
        if (!sourceServerId) return null;

        try {
            const response = await this.transportManager.request(sourceServerId, {
                jsonrpc: '2.0',
                id: `vmcp-${this.definition.id}-prompt-${Date.now()}`,
                method: 'prompts/get',
                params: { name }
            });
            return response.result;
        } catch (error) {
            console.error(`Error fetching prompt ${name} from ${sourceServerId}:`, error);
            return null;
        }
    }

    async checkHealth(): Promise<{ healthy: boolean; details: Record<string, any> }> {
        const health = {
            healthy: this.definition.status === "running",
            details: {
                status: this.definition.status,
                underlyingServers: this.definition.underlyingServersStatus
            }
        };

        // Check health of each source server
        for (const serverId of this.definition.sourceServerIds) {
            try {
                await this.transportManager.request(serverId, {
                    jsonrpc: '2.0',
                    id: `vmcp-${this.definition.id}-health-${Date.now()}`,
                    method: 'health/check'
                });
            } catch (error: any) {
                health.healthy = false;
                health.details.underlyingServers = health.details.underlyingServers.map(
                    (s: any) => s.serverId === serverId ? { ...s, status: 'error', lastError: error?.message || 'Unknown error' } : s
                );
            }
        }

        return health;
    }

    async start(): Promise<void> {
        console.log(`[VMCP ${this.definition.id}] Starting instance on port ${this.definition.port}...`);
        
        await this.stop();

        try {
            await this.aggregateCapabilities();
            
            // Check if we have any capabilities
            const hasCapabilities = this.aggregatedTools.length > 0 || 
                                  this.aggregatedPrompts.length > 0 || 
                                  this.aggregatedResources.length > 0;
            
            if (!hasCapabilities) {
                throw new Error('Cannot start vMCP instance: No capabilities available. Please select at least one capability.');
            }
            
            this.initializeMcpServerLogic();

            this.httpServer = http.createServer(this.handleHttpRequest.bind(this));

            await new Promise<void>((resolve, reject) => {
                if (!this.httpServer) {
                    return reject(new Error('HTTP Server not initialized'));
                }
                this.httpServer.on('error', (err) => {
                    console.error(`[VMCP ${this.definition.id}] HTTP Server Error:`, err);
                    this.httpServer?.close();
                    reject(err);
                });

                this.httpServer.listen(this.definition.port, () => {
                    console.log(`[VMCP ${this.definition.id}] HTTP server listening on port ${this.definition.port}`);
                    resolve();
                });
            });
            
            console.log(`[VMCP ${this.definition.id}] Instance started successfully.`);

        } catch (error) {
            console.error(`[VMCP ${this.definition.id}] Error starting instance:`, error);
            await this.stop();
            throw error;
        }
    }

    private async aggregateCapabilities(): Promise<void> {
        console.log(`[VMCP ${this.definition.id}] Starting capability aggregation...`);
        console.log(`[VMCP ${this.definition.id}] Definition:`, JSON.stringify(this.definition, null, 2));
        
        // Clear existing aggregated capabilities
        this.aggregatedTools = [];
        this.aggregatedPrompts = [];
        this.aggregatedResources = [];
        this.capabilityMap.clear();

        // Extract rules
        const includeToolsRule = this.definition.aggregationRules.find(r => r.type === 'include_tools') as { type: 'include_tools', toolNames: string[] } | undefined;
        const includePromptsRule = this.definition.aggregationRules.find(r => r.type === 'include_prompts') as { type: 'include_prompts', promptNames: string[] } | undefined;
        const includeResourcesRule = this.definition.aggregationRules.find(r => r.type === 'include_resources') as { type: 'include_resources', resourceUris: string[] } | undefined;
        const aggregateAllRule = this.definition.aggregationRules.find(r => r.type === 'aggregate_all') as { type: 'aggregate_all' } | undefined;

        console.log(`[VMCP ${this.definition.id}] Aggregation Rules:`, {
            includeToolsRule,
            includePromptsRule,
            includeResourcesRule,
            aggregateAllRule
        });

        // If we have an aggregate_all rule, we should fetch all capabilities
        const shouldAggregateAll = !!aggregateAllRule;
        console.log(`[VMCP ${this.definition.id}] Should aggregate all: ${shouldAggregateAll}`);
        
        if (this.definition.sourceServerIds.length === 0) {
            console.error(`[VMCP ${this.definition.id}] No source server IDs provided!`);
            return;
        }

        for (const serverId of this.definition.sourceServerIds) {
            console.log(`[VMCP ${this.definition.id}] Processing source server: ${serverId}`);
            
            try {
                // Ensure transport is connected
                const transport = this.transportManager.getTransport(serverId);
                if (!transport) {
                    throw new Error(`No transport found for server ${serverId}`);
                }
                if (!(transport as SSETransport).isTransportConnected) {
                    console.log(`[VMCP ${this.definition.id}] Transport for ${serverId} not connected, attempting to connect...`);
                    await transport.start();
                }

                // Fetch Tools
                if (shouldAggregateAll || includeToolsRule) {
                    console.log(`[VMCP ${this.definition.id}] Fetching tools from ${serverId}...`);
                    const toolsResponse = await this.transportManager.request(serverId, { 
                        jsonrpc: '2.0', 
                        id: `vmcp-${this.definition.id}-tools-${Date.now()}`,
                        method: 'tools/list' 
                    }) as JSONRPCResponse;
                    
                    console.log(`[VMCP ${this.definition.id}] Tools response from ${serverId}:`, JSON.stringify(toolsResponse, null, 2));
                    
                    if (toolsResponse?.result?.tools) {
                        const sourceTools = toolsResponse.result.tools as Tool[];
                        console.log(`[VMCP ${this.definition.id}] Found ${sourceTools.length} tools from ${serverId}`);
                 
                        let toolsToAdd: Tool[] = [];
                        if (shouldAggregateAll) {
                            toolsToAdd = sourceTools;
                        } else if (includeToolsRule) {
                            toolsToAdd = sourceTools.filter(tool => includeToolsRule.toolNames.includes(tool.name));
                            console.log(`[VMCP ${this.definition.id}] Filtered to ${toolsToAdd.length} tools based on selection`);
                        }
                        
                        toolsToAdd.forEach(tool => {
                            if (!this.capabilityMap.has(tool.name)) {
                                this.aggregatedTools.push(tool);
                                this.capabilityMap.set(tool.name, serverId);
                                console.log(`[VMCP ${this.definition.id}] Added tool: ${tool.name} from ${serverId}`);
                            } else {
                                console.warn(`[VMCP ${this.definition.id}] Duplicate tool name '${tool.name}' from ${serverId} ignored.`);
                            }
                        });
                    } else {
                        console.log(`[VMCP ${this.definition.id}] No tools found from ${serverId}`);
                    }
                }

                // Fetch Prompts
                if (shouldAggregateAll || includePromptsRule) {
                    console.log(`[VMCP ${this.definition.id}] Fetching prompts from ${serverId}...`);
                    const promptsResponse = await this.transportManager.request(serverId, { 
                        jsonrpc: '2.0', 
                        id: `vmcp-${this.definition.id}-prompts-${Date.now()}`, 
                        method: 'prompts/list' 
                    }) as JSONRPCResponse;
                    
                    console.log(`[VMCP ${this.definition.id}] Prompts response from ${serverId}:`, JSON.stringify(promptsResponse, null, 2));
                    
                    if (promptsResponse?.result?.prompts) {
                        const sourcePrompts = promptsResponse.result.prompts as Prompt[];
                        console.log(`[VMCP ${this.definition.id}] Found ${sourcePrompts.length} prompts from ${serverId}`);
                        
                        let promptsToAdd: Prompt[] = [];
                        if (shouldAggregateAll) {
                            promptsToAdd = sourcePrompts;
                        } else if (includePromptsRule) {
                            promptsToAdd = sourcePrompts.filter(prompt => includePromptsRule.promptNames.includes(prompt.name));
                            console.log(`[VMCP ${this.definition.id}] Filtered to ${promptsToAdd.length} prompts based on selection`);
                        }
                        
                        promptsToAdd.forEach(prompt => {
                            if (!this.capabilityMap.has(prompt.name)) {
                                this.aggregatedPrompts.push(prompt);
                                this.capabilityMap.set(prompt.name, serverId);
                                console.log(`[VMCP ${this.definition.id}] Added prompt: ${prompt.name} from ${serverId}`);
                            } else {
                                console.warn(`[VMCP ${this.definition.id}] Duplicate prompt name '${prompt.name}' from ${serverId} ignored.`);
                            }
                        });
                    } else {
                        console.log(`[VMCP ${this.definition.id}] No prompts found from ${serverId}`);
                    }
                }

                // Fetch Resources
                if (shouldAggregateAll || includeResourcesRule) {
                    console.log(`[VMCP ${this.definition.id}] Fetching resources from ${serverId}...`);
                    const resourcesResponse = await this.transportManager.request(serverId, { 
                        jsonrpc: '2.0', 
                        id: `vmcp-${this.definition.id}-resources-${Date.now()}`, 
                        method: 'resources/list' 
                    }) as JSONRPCResponse;
                    
                    console.log(`[VMCP ${this.definition.id}] Resources response from ${serverId}:`, JSON.stringify(resourcesResponse, null, 2));
                    
                    if (resourcesResponse?.result?.resources) {
                        const sourceResources = resourcesResponse.result.resources as Resource[];
                        console.log(`[VMCP ${this.definition.id}] Found ${sourceResources.length} resources from ${serverId}`);
                        
                        let resourcesToAdd: Resource[] = [];
                        if (shouldAggregateAll) {
                            resourcesToAdd = sourceResources;
                        } else if (includeResourcesRule) {
                            resourcesToAdd = sourceResources.filter(resource => includeResourcesRule.resourceUris.includes(resource.uri));
                            console.log(`[VMCP ${this.definition.id}] Filtered to ${resourcesToAdd.length} resources based on selection`);
                        }
                        
                        resourcesToAdd.forEach(resource => {
                            if (!this.capabilityMap.has(resource.uri)) {
                                this.aggregatedResources.push(resource);
                                this.capabilityMap.set(resource.uri, serverId);
                                console.log(`[VMCP ${this.definition.id}] Added resource: ${resource.uri} from ${serverId}`);
                            } else {
                                console.warn(`[VMCP ${this.definition.id}] Duplicate resource URI '${resource.uri}' from ${serverId} ignored.`);
                            }
                        });
                    } else {
                        console.log(`[VMCP ${this.definition.id}] No resources found from ${serverId}`);
                    }
                }
            } catch (error) { 
                console.error(`[VMCP ${this.definition.id}] Error fetching capabilities from ${serverId}:`, error);
                console.error(`[VMCP ${this.definition.id}] Error details:`, {
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
                // Don't throw here, continue with other servers
            }
        }

        console.log(`[VMCP ${this.definition.id}] Final aggregated capabilities:`, {
            tools: this.aggregatedTools.length,
            prompts: this.aggregatedPrompts.length,
            resources: this.aggregatedResources.length,
            capabilityMap: Object.fromEntries(this.capabilityMap)
        });

        // Throw an error if no capabilities were aggregated
        if (this.aggregatedTools.length === 0 && this.aggregatedPrompts.length === 0 && this.aggregatedResources.length === 0) {
            throw new Error('No capabilities were successfully aggregated from any source server.');
        }
    }

    private initializeMcpServerLogic(): void {
        console.log(`[VMCP ${this.definition.id}] Initializing MCP server logic...`);
        
        // Determine which capabilities are available
        const hasTools = this.aggregatedTools.length > 0;
        const hasPrompts = this.aggregatedPrompts.length > 0;
        const hasResources = this.aggregatedResources.length > 0;
        
        // Initialize server with only available capabilities
        this.mcpServer = new Server(
            { name: this.definition.name, version: '1.0.0' }, 
            { 
                capabilities: {
                    tools: hasTools ? { list: true, call: true } : undefined,
                    prompts: hasPrompts ? { list: true, get: true } : undefined,
                    resources: hasResources ? { list: true, get: true } : undefined
                } 
            }
        );
        
        if (!this.mcpServer) {
            throw new Error('Failed to initialize MCP server');
        }
        
        // Only set up handlers for available capabilities
        if (hasTools) {
            this.mcpServer.setRequestHandler(ListToolsRequestSchema, async (_r: z.infer<typeof ListToolsRequestSchema>) => ({ tools: this.aggregatedTools }));
            this.mcpServer.setRequestHandler(CallToolRequestSchema, async (r: z.infer<typeof CallToolRequestSchema>) => 
                this.proxyRequest(r, 'tools/call', r.params.name));
        }
        
        if (hasPrompts) {
            this.mcpServer.setRequestHandler(ListPromptsRequestSchema, async (_r: z.infer<typeof ListPromptsRequestSchema>) => ({ prompts: this.aggregatedPrompts }));
            this.mcpServer.setRequestHandler(GetPromptRequestSchema, async (r: z.infer<typeof GetPromptRequestSchema>) => 
                this.proxyRequest(r, 'prompts/get', r.params.name));
        }
        
        if (hasResources) {
            this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async (_r: z.infer<typeof ListResourcesRequestSchema>) => ({ resources: this.aggregatedResources }));
            this.mcpServer.setRequestHandler(GetResourceRequestSchema, async (r: z.infer<typeof GetResourceRequestSchema>) => 
                this.proxyRequest(r, 'resources/get', r.params.uri));
        }
        
        console.log(`[VMCP ${this.definition.id}] MCP server initialized with capabilities:`, {
            tools: hasTools,
            prompts: hasPrompts,
            resources: hasResources
        });
    }
    
    private async proxyRequest(request: JSONRPCRequest, method: string, capabilityIdentifier: string): Promise<any> {
        let targetServerId = this.capabilityMap.get(capabilityIdentifier);

        if (!targetServerId && method === 'resources/get') {
            const match = capabilityIdentifier.match(/^mcp:\/\/([^\/]+)/);
            if (match && match[1] && this.definition.sourceServerIds.includes(match[1])) {
                targetServerId = match[1];
            }
        }
        
        if (!targetServerId) {
            throw new McpError(ErrorCode.MethodNotFound, `Capability '${capabilityIdentifier}' could not be mapped to a source server`);
        }

        const proxyRequest: JSONRPCRequest = { 
            jsonrpc: '2.0',
            method: method,
            params: request.params,
            id: `vmcp-proxy-${request.id}-${Date.now()}`
        };
        
        const response = await this.transportManager.request(targetServerId, proxyRequest);
        
        if (response.error) {
            throw new McpError(response.error.code, response.error.message, response.error.data);
        }
        return response.result;
    }

    private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const parsedUrl = url.parse(req.url || '', true);
        const pathname = parsedUrl.pathname;
        const method = req.method?.toUpperCase();

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (method === 'GET' && pathname === '/sse') {
            console.log(`[VMCP ${this.definition.id}] Received new SSE connection request`);
            if (!this.mcpServer) {
                res.writeHead(500).end('vMCP logic not initialized');
                return;
            }
            try {
                const postEndpoint = '/message'; 
                const transport = new SSEServerTransport(postEndpoint, res);
                const connectionId = transport.sessionId;
                this.activeClientTransports.set(connectionId, transport);
                console.log(`[VMCP ${this.definition.id}] SSE connection ${connectionId} established.`);

                transport.onclose = () => {
                    console.log(`[VMCP ${this.definition.id}] SSE connection ${connectionId} closed.`);
                    this.activeClientTransports.delete(connectionId);
                };
                transport.onerror = (err: Error) => {
                     console.error(`[VMCP ${this.definition.id}] SSE connection ${connectionId} error:`, err);
                     this.activeClientTransports.delete(connectionId);
                }

                await this.mcpServer.connect(transport);
            
            } catch (error) {
                 console.error(`[VMCP ${this.definition.id}] Error setting up SSE connection:`, error);
                 if (!res.headersSent) {
                     res.writeHead(500).end('Failed to establish SSE connection');
                 }
            }

        } else if (method === 'POST' && pathname === '/message') {
            const sessionId = parsedUrl.query.sessionId as string;
            const transport = this.activeClientTransports.get(sessionId);
            
            if (!transport) {
                console.warn(`[VMCP ${this.definition.id}] Received POST for unknown session ID: ${sessionId}`);
                res.writeHead(404).end('Session not found');
                return;
            }

            try {
                await transport.handlePostMessage(req, res);
            } catch (error) {
                 console.error(`[VMCP ${this.definition.id}] Error handling POST message for session ${sessionId}:`, error);
                 if (!res.headersSent) {
                    res.writeHead(500).end('Error processing message');
                 }
            }

        } else {
            res.writeHead(404).end('Not Found');
        }
    }

    async stop(): Promise<void> {
        console.log(`[VMCP ${this.definition.id}] Stopping instance...`);

        for (const [id, transport] of this.activeClientTransports.entries()) {
            console.log(`[VMCP ${this.definition.id}] Closing client connection ${id}...`);
            try {
                await transport.close();
            } catch (error) {
                console.warn(`[VMCP ${this.definition.id}] Error closing client transport ${id}:`, error);
            }
        }
        this.activeClientTransports.clear();

        if (this.mcpServer) {
             try {
                 if (typeof this.mcpServer.close === 'function') {
                    await this.mcpServer.close();
                 }
            } catch (error) {
                console.warn(`[VMCP ${this.definition.id}] Error closing MCP server logic:`, error);
            }
            this.mcpServer = null;
        }

        if (this.httpServer) {
            console.log(`[VMCP ${this.definition.id}] Closing HTTP server...`);
            try {
                await new Promise<void>((resolve, reject) => {
                    this.httpServer?.close((err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
                 console.log(`[VMCP ${this.definition.id}] HTTP server closed.`);
            } catch (error) {
                 console.warn(`[VMCP ${this.definition.id}] Error closing HTTP server:`, error);
            }
            this.httpServer = null;
        }

        console.log(`[VMCP ${this.definition.id}] Instance stopped successfully`);
    }
    
    // Removed placeholder findSourceServerFor... methods as logic is now in handlers
} 