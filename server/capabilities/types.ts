import { z } from 'zod';

// Base schema for capabilities
export const BaseCapabilitySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.string(), // Add source server ID
});

// Tool specific schema, extending base
export const ToolSchema = BaseCapabilitySchema.extend({
  parameters: z.record(z.any()).optional(), // Keeping parameters flexible for now
  inputSchema: z.record(z.any()).optional(), // Keeping inputSchema flexible
});

// Prompt specific schema, extending base
export const PromptSchema = BaseCapabilitySchema.extend({
  template: z.string(),
  arguments: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
  })).optional(),
});

// Resource specific schema, extending base
export const ResourceSchema = BaseCapabilitySchema.extend({
  uri: z.string(),
  mimeType: z.string().optional(),
  // Assuming text/blob are not stored directly in registry, maybe just URI/metadata
});

// Infer TypeScript types from Zod schemas
export type Tool = z.infer<typeof ToolSchema>;
export type Prompt = z.infer<typeof PromptSchema>;
export type Resource = z.infer<typeof ResourceSchema>;

// Interface removed as types are inferred now
// export interface Capability {
//   tools: Map<string, Tool>;
//   prompts: Map<string, Prompt>;
// } 