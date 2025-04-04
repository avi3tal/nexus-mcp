import { z } from 'zod';

export const MCPServerConfigSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  transport: z.string(),
  auth: z.object({
    type: z.string(),
    config: z.record(z.unknown()).optional()
  }).optional(),
  capabilities: z.object({
    tools: z.record(z.object({
      name: z.string(),
      description: z.string().optional(),
      inputSchema: z.object({
        type: z.literal('object'),
        properties: z.record(z.unknown()),
        required: z.array(z.string()).optional()
      })
    })),
    prompts: z.record(z.object({
      name: z.string(),
      description: z.string().optional(),
      arguments: z.array(z.object({
        name: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional()
      })).optional()
    })),
    resources: z.record(z.object({
      name: z.string(),
      description: z.string().optional(),
      type: z.string()
    }))
  }).optional(),
  status: z.enum(['online', 'offline', 'error']).optional(),
  isDisabled: z.boolean().optional(),
  lastSeen: z.string().optional(),
  id: z.string().optional()
});

export const vMCPConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  server: z.string(),
  capabilities: z.object({
    tools: z.array(z.string()),
    prompts: z.array(z.string()),
    resources: z.array(z.string())
  }),
  tools: z.array(z.string()).optional(),
  prompts: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional()
});

export const NexusConfigSchema = z.object({
  port: z.number().default(3000),
  mcpServers: z.array(MCPServerConfigSchema).default([]),
  vmcps: z.array(vMCPConfigSchema).default([]),
  persistence: z.object({
    type: z.string().default('memory'),
    config: z.record(z.unknown()).default({})
  }).default({ type: 'memory', config: {} })
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type vMCPConfig = z.infer<typeof vMCPConfigSchema>;
export type NexusConfig = z.infer<typeof NexusConfigSchema>; 