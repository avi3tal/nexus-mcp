import type { Tool, Prompt, Resource as MCPResource } from '@modelcontextprotocol/sdk';

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  transport: string;
  status: 'online' | 'offline' | 'error';
  lastSeen: string;
  tools: Tool[];
  prompts: Prompt[];
  resources: MCPResource[];
  isVirtual?: boolean;
  isDisabled?: boolean;
}

export interface Resource {
  id: string;
  name: string;
  type: 'tool' | 'prompt' | 'resource';
  content: any;
  metadata?: ResourceMetadata;
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