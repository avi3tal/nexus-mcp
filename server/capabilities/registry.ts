import { Tool, Prompt, ToolSchema, PromptSchema } from './types.js';
import { CapabilityError } from './errors.js';

export class CapabilityRegistry {
  private tools: Map<string, Tool> = new Map();
  private prompts: Map<string, Prompt> = new Map();

  registerTool(tool: Tool): void {
    try {
      ToolSchema.parse(tool);
    } catch (error) {
      throw CapabilityError.invalidTool(error);
    }

    const existing = this.tools.get(tool.name);
    if (existing && existing.source !== tool.source) {
      throw CapabilityError.duplicateTool(tool.name, existing.source);
    }

    this.tools.set(tool.name, tool);
  }

  registerPrompt(prompt: Prompt): void {
    try {
      PromptSchema.parse(prompt);
    } catch (error) {
      throw CapabilityError.invalidPrompt(error);
    }

    const existing = this.prompts.get(prompt.name);
    if (existing && existing.source !== prompt.source) {
      throw CapabilityError.duplicatePrompt(prompt.name, existing.source);
    }

    this.prompts.set(prompt.name, prompt);
  }

  getTool(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw CapabilityError.toolNotFound(name);
    }
    return tool;
  }

  getPrompt(name: string): Prompt {
    const prompt = this.prompts.get(name);
    if (!prompt) {
      throw CapabilityError.promptNotFound(name);
    }
    return prompt;
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getAllPrompts(): Prompt[] {
    return Array.from(this.prompts.values());
  }

  removeTool(name: string): void {
    if (!this.tools.has(name)) {
      throw CapabilityError.toolNotFound(name);
    }
    this.tools.delete(name);
  }

  removePrompt(name: string): void {
    if (!this.prompts.has(name)) {
      throw CapabilityError.promptNotFound(name);
    }
    this.prompts.delete(name);
  }

  clear(): void {
    this.tools.clear();
    this.prompts.clear();
  }
} 