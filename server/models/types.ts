import { z } from 'zod';

export const MCPServerSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  auth: z.object({
    type: z.literal('oauth2'),
    clientId: z.string(),
    clientSecret: z.string()
  }).optional(),
  status: z.enum(['active', 'inactive', 'error']).default('active'),
  lastSeen: z.date().optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date())
});

export const vMCPInstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tools: z.array(z.object({
    name: z.string(),
    server: z.string(),
    config: z.record(z.unknown()).optional()
  })),
  resources: z.array(z.object({
    uri: z.string(),
    server: z.string()
  })).optional(),
  status: z.enum(['running', 'stopped', 'error']).default('stopped'),
  port: z.number().optional(),
  memoryUsage: z.string().optional(),
  uptime: z.number().optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date())
});

export type MCPServer = z.infer<typeof MCPServerSchema>;
export type vMCPInstance = z.infer<typeof vMCPInstanceSchema>; 