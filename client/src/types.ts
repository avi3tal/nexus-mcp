import type { Tool, Prompt, Resource as MCPResource } from '@modelcontextprotocol/sdk';

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  transport: string;
  status?: 'online' | 'offline' | 'error';
  lastSeen?: string;
  isDisabled?: boolean;
  capabilities?: {
    tools?: any; // Define more specific types if needed
    prompts?: any;
    resources?: any;
  };
  tools: Tool[];
  prompts: Prompt[];
  resources: MCPResource[];
  isVirtual?: boolean;
}

export interface SimpleMCPServer {
  id: string;
  name: string;
  url: string;
}

export interface Resource {
  uri: string;
  name: string;
  type: string;
  content?: string;
}

export interface ResourceMetadata {
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface VMCP {
  id: string;
  name: string;
  tools: Resource[];
  prompts: Resource[];
  resources: Resource[];
  createdAt: string;
  updatedAt: string;
}

export interface VMCPInstance {
  id: string;
  name: string;
  port: number;
  sourceServerIds: string[];
  status: 'stopped' | 'starting' | 'running' | 'error' | 'partially_degraded';
  // Add other relevant fields displayed in the UI
} 