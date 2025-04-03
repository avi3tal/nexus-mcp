import { z } from 'zod';

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()),
  parameters: z.record(z.unknown()).optional(),
  source: z.string()
});

export const PromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  template: z.string().optional(),
  arguments: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional()
  })).optional(),
  source: z.string()
});

export type Tool = z.infer<typeof ToolSchema>;
export type Prompt = z.infer<typeof PromptSchema>;

export interface Capability {
  tools: Map<string, Tool>;
  prompts: Map<string, Prompt>;
} 