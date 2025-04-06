import { Server } from '@modelcontextprotocol/sdk/server';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import * as http from 'http';
import * as url from 'url';
import { VMCPDefinition, CapabilityMapping } from './types.js';
import { TransportManager } from '../transport/manager.js';
import { SSETransport } from '../transport/SSETransport.js';
import type { JSONRPCMessage, JSONRPCResponse, JSONRPCRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TransportError, TransportErrorCode } from '../transport/TransportError.js';
import { CapabilityError, CapabilityErrorCode } from '../capabilities/errors.js';
import type { Tool as McpTool, Prompt as McpPrompt, Resource as McpResource } from '../capabilities/types.js';
import { VMCPAggregationRule } from './types.js';

// Define types manually based on protocol spec if not exported
interface Tool extends McpTool {}
interface Prompt extends McpPrompt {}
interface Resource extends McpResource {}

// Basic Error structure (adapt ErrorCode values if known)
enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
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
    params: z.any().optional() // Accept any params or none for list requests
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
    params: z.any().optional() // Accept any params or none for list requests
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
    params: z.any().optional() // Accept any params or none for list requests
});

const GetResourceRequestSchema = BaseRequestSchema.extend({
    method: z.literal('resources/get'),
    params: z.object({
        uri: z.string()
    })
});

interface CapabilityInfo {
    serverId: string;
    toolName: string;
}

interface ServerCapabilities {
    tools: Tool[];
    prompts: Prompt[];
    resources: Resource[];
}

export class VMCPInstance {
    private mcpServer: Server | null = null;
    private httpServer: http.Server | null = null;
    private activeClientTransports: Map<string, SSEServerTransport> = new Map();
    private capabilityMap: Map<string, CapabilityInfo> = new Map();
    private aggregatedTools: Tool[] = [];
    private aggregatedPrompts: Prompt[] = [];
    private aggregatedResources: Resource[] = [];

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

        const mapKey = `${this.definition.id}:${uri}`;
        const capabilityInfo = this.capabilityMap.get(mapKey);
        if (!capabilityInfo) return null;

        try {
            const message: JSONRPCMessage & { id: string } = {
                jsonrpc: '2.0',
                id: `vmcp-${this.definition.id}-resource-${Date.now()}`,
                method: 'resources/get',
                params: { uri }
            };
            const response = await this.transportManager.request(capabilityInfo.serverId, message);
            return response.result;
        } catch (error) {
            console.error(`Error fetching resource ${uri} from ${capabilityInfo.serverId}:`, error);
            return null;
        }
    }

    async listTools(): Promise<Tool[]> {
        await this.aggregateCapabilities();
        return this.aggregatedTools;
    }

    async callTool(name: string, args: any): Promise<any> {
        await this.aggregateCapabilities();
        const mapKey = `${this.definition.id}:${name}`;
        const capabilityInfo = this.capabilityMap.get(mapKey);
        if (!capabilityInfo) {
            throw new CapabilityError(CapabilityErrorCode.TOOL_NOT_FOUND, `Tool ${name} not found in vMCP ${this.definition.id}`);
        }

        try {
            const message: JSONRPCMessage & { id: string } = {
                jsonrpc: '2.0',
                id: `vmcp-${this.definition.id}-tool-${Date.now()}`,
                method: 'tools/call',
                params: { name: capabilityInfo.toolName, arguments: args }
            };
            const response = await this.transportManager.request(capabilityInfo.serverId, message);
            return response.result;
        } catch (error) {
            console.error(`Error calling tool ${name} on ${capabilityInfo.serverId}:`, error);
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

        const mapKey = `${this.definition.id}:${name}`;
        const capabilityInfo = this.capabilityMap.get(mapKey);
        if (!capabilityInfo) return null;

        try {
            const message: JSONRPCMessage & { id: string } = {
                jsonrpc: '2.0',
                id: `vmcp-${this.definition.id}-prompt-${Date.now()}`,
                method: 'prompts/get',
                params: { name: capabilityInfo.toolName }
            };
            const response = await this.transportManager.request(capabilityInfo.serverId, message);
            return response.result;
        } catch (error) {
            console.error(`Error fetching prompt ${name} from ${capabilityInfo.serverId}:`, error);
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

        // Process each source server
        for (const serverId of this.definition.sourceServerIds) {
            try {
                // Get capabilities from source server
                const capabilities = await this.fetchCapabilities(serverId);
                
                // Apply aggregation rules
                for (const rule of this.definition.aggregationRules) {
                    switch (rule.type) {
                        case 'aggregate_all':
                            // Add all tools, prompts, and resources
                            this.aggregateTools(serverId, capabilities.tools);
                            this.aggregatePrompts(serverId, capabilities.prompts);
                            this.aggregateResources(serverId, capabilities.resources);
                            break;
                        case 'include_tools':
                            // Add only specified tools
                            if (rule.toolNames) {
                                const filteredTools = capabilities.tools.filter(tool => rule.toolNames.includes(tool.name));
                                this.aggregateTools(serverId, filteredTools);
                            }
                            break;
                        case 'include_prompts':
                            // Add only specified prompts
                            if (rule.promptNames) {
                                const filteredPrompts = capabilities.prompts.filter(prompt => rule.promptNames.includes(prompt.name));
                                this.aggregatePrompts(serverId, filteredPrompts);
                            }
                            break;
                        case 'include_resources':
                            // Add only specified resources
                            if (rule.resourceUris) {
                                const filteredResources = capabilities.resources.filter(resource => rule.resourceUris.includes(resource.uri));
                                this.aggregateResources(serverId, filteredResources);
                            }
                            break;
                    }
                }
            } catch (error) {
                console.error(`Error aggregating capabilities from server ${serverId}:`, error);
                // Consider how to handle partial failures (maybe set a degraded state?)
                throw error;
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

    private aggregateTools(serverId: string, tools: Tool[]): void {
        for (const tool of tools) {
            const mapKey = `${this.definition.id}:${tool.name}`;
            this.capabilityMap.set(mapKey, { serverId, toolName: tool.name });
            this.aggregatedTools.push(tool);
        }
    }

    private aggregatePrompts(serverId: string, prompts: Prompt[]): void {
        for (const prompt of prompts) {
            const mapKey = `${this.definition.id}:${prompt.name}`;
            this.capabilityMap.set(mapKey, { serverId, toolName: prompt.name });
            this.aggregatedPrompts.push(prompt);
        }
    }

    private aggregateResources(serverId: string, resources: Resource[]): void {
        for (const resource of resources) {
            const mapKey = `${this.definition.id}:${resource.uri}`;
            this.capabilityMap.set(mapKey, { serverId, toolName: resource.uri });
            this.aggregatedResources.push(resource);
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
        const mapKey = `${this.definition.id}:${capabilityIdentifier}`;
        const capabilityInfo = this.capabilityMap.get(mapKey);

        if (!capabilityInfo) {
            // Special handling for resource URIs
            if (method === 'resources/get') {
                const match = capabilityIdentifier.match(/^mcp:\/\/([^\/]+)/);
                if (match && match[1] && this.definition.sourceServerIds.includes(match[1])) {
                    const serverId = match[1];
                    const message: JSONRPCMessage & { id: string } = {
                        jsonrpc: '2.0',
                        method: method,
                        params: request.params,
                        id: `vmcp-proxy-${request.id}-${Date.now()}`
                    };
                    return await this.transportManager.request(serverId, message);
                }
            }
            throw new CapabilityError(CapabilityErrorCode.RESOURCE_NOT_FOUND, `Capability '${capabilityIdentifier}' could not be mapped to a source server`);
        }

        const message: JSONRPCMessage & { id: string } = {
            jsonrpc: '2.0',
            method: method,
            params: request.params,
            id: `vmcp-proxy-${request.id}-${Date.now()}`
        };
        
        const response = await this.transportManager.request(capabilityInfo.serverId, message);
        
        if (response.error) {
            throw new TransportError(
                response.error.message,
                TransportErrorCode.RPC_ERROR,
                { serverId: capabilityInfo.serverId, error: response.error },
                false
            );
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
    
    private async fetchCapabilities(serverId: string): Promise<ServerCapabilities> {
        const transport = this.transportManager.getTransport(serverId);
        if (!transport) {
            throw new Error(`No transport found for server ${serverId}`);
        }

        const toolsResponse = await this.transportManager.request(serverId, {
            jsonrpc: '2.0',
            id: `vmcp-${this.definition.id}-tools-${Date.now()}`,
            method: 'tools/list'
        }) as JSONRPCResponse;

        const promptsResponse = await this.transportManager.request(serverId, {
            jsonrpc: '2.0',
            id: `vmcp-${this.definition.id}-prompts-${Date.now()}`,
            method: 'prompts/list'
        }) as JSONRPCResponse;

        const resourcesResponse = await this.transportManager.request(serverId, {
            jsonrpc: '2.0',
            id: `vmcp-${this.definition.id}-resources-${Date.now()}`,
            method: 'resources/list'
        }) as JSONRPCResponse;

        return {
            tools: toolsResponse.result?.tools || [],
            prompts: promptsResponse.result?.prompts || [],
            resources: resourcesResponse.result?.resources || []
        };
    }
} 