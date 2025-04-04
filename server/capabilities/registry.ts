import { Tool, Prompt, Resource, ToolSchema, PromptSchema, ResourceSchema } from './types.js';
import { CapabilityError } from './errors.js';

export class CapabilityRegistry {
  // Store capabilities per server
  private toolsByServer: Map<string, Map<string, Tool>> = new Map(); 
  private promptsByServer: Map<string, Map<string, Prompt>> = new Map();
  private resourcesByServer: Map<string, Map<string, Resource>> = new Map();

  // Ensure server map exists
  private ensureServerMaps(serverId: string): void {
    if (!this.toolsByServer.has(serverId)) {
      this.toolsByServer.set(serverId, new Map());
    }
    if (!this.promptsByServer.has(serverId)) {
      this.promptsByServer.set(serverId, new Map());
    }
    if (!this.resourcesByServer.has(serverId)) {
      this.resourcesByServer.set(serverId, new Map());
    }
  }

  registerTool(tool: Tool): void {
    if (!tool.source) {
      throw new Error('Tool must have a source serverId.');
    }
    this.ensureServerMaps(tool.source);
    const serverTools = this.toolsByServer.get(tool.source)!;

    try {
      ToolSchema.parse(tool);
    } catch (error) {
      throw CapabilityError.invalidTool(error);
    }

    // No need to check for duplicates across servers now, only within a server
    // const existing = serverTools.get(tool.name);
    // if (existing) { ... } // Optional: check for duplicates within the same server source?

    serverTools.set(tool.name, tool);
  }

  registerPrompt(prompt: Prompt): void {
    if (!prompt.source) {
      throw new Error('Prompt must have a source serverId.');
    }
    this.ensureServerMaps(prompt.source);
    const serverPrompts = this.promptsByServer.get(prompt.source)!;

    try {
      PromptSchema.parse(prompt);
    } catch (error) {
      throw CapabilityError.invalidPrompt(error);
    }

    serverPrompts.set(prompt.name, prompt);
  }

  registerResource(resource: Resource): void {
    if (!resource.source) {
      throw new Error('Resource must have a source serverId.');
    }
    this.ensureServerMaps(resource.source);
    const serverResources = this.resourcesByServer.get(resource.source)!;

    try {
      ResourceSchema.parse(resource);
    } catch (error) {
      throw CapabilityError.invalidResource(error);
    }

    serverResources.set(resource.uri, resource);
  }

  // Get capabilities for a specific server
  getToolsForServer(serverId: string): Tool[] {
    const serverTools = this.toolsByServer.get(serverId);
    return serverTools ? Array.from(serverTools.values()) : [];
  }

  getPromptsForServer(serverId: string): Prompt[] {
    const serverPrompts = this.promptsByServer.get(serverId);
    return serverPrompts ? Array.from(serverPrompts.values()) : [];
  }

  getResourcesForServer(serverId: string): Resource[] {
    const serverResources = this.resourcesByServer.get(serverId);
    return serverResources ? Array.from(serverResources.values()) : [];
  }

  // Getters for specific items (might need adjustment if name isn't unique across servers)
  getTool(name: string): Tool | undefined { // Now might return undefined if name isn't globally unique
     for (const serverTools of this.toolsByServer.values()) {
        if (serverTools.has(name)) {
            return serverTools.get(name);
        }
     }
     return undefined; // Or throw specific error?
     // throw CapabilityError.toolNotFound(name); 
  }

  getPrompt(name: string): Prompt | undefined { 
     for (const serverPrompts of this.promptsByServer.values()) {
        if (serverPrompts.has(name)) {
            return serverPrompts.get(name);
        }
     }
     return undefined;
    // throw CapabilityError.promptNotFound(name);
  }

  getResource(uri: string): Resource | undefined { 
     for (const serverResources of this.resourcesByServer.values()) {
        if (serverResources.has(uri)) {
            return serverResources.get(uri);
        }
     }
     return undefined;
  }

  // Get *all* capabilities across *all* servers
  getAllTools(): Tool[] {
    let allTools: Tool[] = [];
    this.toolsByServer.forEach(serverTools => {
      allTools = allTools.concat(Array.from(serverTools.values()));
    });
    return allTools;
  }

  getAllPrompts(): Prompt[] {
    let allPrompts: Prompt[] = [];
    this.promptsByServer.forEach(serverPrompts => {
      allPrompts = allPrompts.concat(Array.from(serverPrompts.values()));
    });
    return allPrompts;
  }

  getAllResources(): Resource[] {
    let allResources: Resource[] = [];
    this.resourcesByServer.forEach(serverResources => {
      allResources = allResources.concat(Array.from(serverResources.values()));
    });
    return allResources;
  }

  // Removal logic needs update to specify server
  removeTool(serverId: string, name: string): void {
    const serverTools = this.toolsByServer.get(serverId);
    if (!serverTools || !serverTools.has(name)) {
      // Still useful to know which serverId was intended if logging, but error method expects only name
      throw CapabilityError.toolNotFound(name); 
    }
    serverTools.delete(name);
  }

  removePrompt(serverId: string, name: string): void {
    const serverPrompts = this.promptsByServer.get(serverId);
    if (!serverPrompts || !serverPrompts.has(name)) {
      throw CapabilityError.promptNotFound(name);
    }
    serverPrompts.delete(name);
  }

  removeResource(serverId: string, uri: string): void {
    const serverResources = this.resourcesByServer.get(serverId);
    if (!serverResources || !serverResources.has(uri)) {
      throw CapabilityError.resourceNotFound(uri);
    }
    serverResources.delete(uri);
  }

  // Clear methods need update
  clearServerCapabilities(serverId: string): void {
     this.toolsByServer.delete(serverId);
     this.promptsByServer.delete(serverId);
     this.resourcesByServer.delete(serverId);
  }
  
  clearAll(): void {
    this.toolsByServer.clear();
    this.promptsByServer.clear();
    this.resourcesByServer.clear();
  }
} 