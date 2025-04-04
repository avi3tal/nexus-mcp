declare module '@modelcontextprotocol/sdk' {
  export interface Tool {
    name: string;
    description?: string;
    inputSchema: {
      type: 'object';
      properties?: Record<string, any>;
      required?: string[];
    };
  }

  export interface Prompt {
    name: string;
    description?: string;
    content: string;
  }

  export interface Resource {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }
} 