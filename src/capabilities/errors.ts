export enum CapabilityErrorCode {
  INVALID_TOOL = 'INVALID_TOOL',
  INVALID_PROMPT = 'INVALID_PROMPT',
  DUPLICATE_TOOL = 'DUPLICATE_TOOL',
  DUPLICATE_PROMPT = 'DUPLICATE_PROMPT',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  PROMPT_NOT_FOUND = 'PROMPT_NOT_FOUND',
  SERVER_NOT_FOUND = 'SERVER_NOT_FOUND',
  DISCOVERY_FAILED = 'DISCOVERY_FAILED',
  TOOLS_DISCOVERY_FAILED = 'TOOLS_DISCOVERY_FAILED',
  PROMPTS_DISCOVERY_FAILED = 'PROMPTS_DISCOVERY_FAILED'
}

export class CapabilityError extends Error {
  constructor(
    public code: CapabilityErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CapabilityError';
  }

  static invalidTool(details: unknown): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.INVALID_TOOL,
      'Invalid tool definition',
      details
    );
  }

  static invalidPrompt(details: unknown): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.INVALID_PROMPT,
      'Invalid prompt definition',
      details
    );
  }

  static duplicateTool(name: string, source: string): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.DUPLICATE_TOOL,
      `Tool ${name} already registered from ${source}`,
      { name, source }
    );
  }

  static duplicatePrompt(name: string, source: string): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.DUPLICATE_PROMPT,
      `Prompt ${name} already registered from ${source}`,
      { name, source }
    );
  }

  static toolNotFound(name: string): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.TOOL_NOT_FOUND,
      `Tool ${name} not found`,
      { name }
    );
  }

  static promptNotFound(name: string): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.PROMPT_NOT_FOUND,
      `Prompt ${name} not found`,
      { name }
    );
  }

  static serverNotFound(serverId: string): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.SERVER_NOT_FOUND,
      `Server ${serverId} not found`,
      { serverId }
    );
  }

  static discoveryFailed(serverId: string, error: unknown): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.DISCOVERY_FAILED,
      `Failed to discover capabilities from server ${serverId}`,
      { serverId, error }
    );
  }

  static toolsDiscoveryFailed(serverId: string, error: unknown): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.TOOLS_DISCOVERY_FAILED,
      `Failed to discover tools from server ${serverId}`,
      { serverId, error }
    );
  }

  static promptsDiscoveryFailed(serverId: string, error: unknown): CapabilityError {
    return new CapabilityError(
      CapabilityErrorCode.PROMPTS_DISCOVERY_FAILED,
      `Failed to discover prompts from server ${serverId}`,
      { serverId, error }
    );
  }
} 