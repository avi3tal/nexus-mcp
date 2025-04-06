declare module '@modelcontextprotocol/sdk/server' {
  export class Server {
    constructor(info: {
      name: string;
      version: string;
    }, capabilities?: {
      capabilities: {
        tools: Record<string, any>;
        prompts: Record<string, any>;
        resources: Record<string, any>;
      }
    });
    
    capability_set: string[];
    info: {
      name: string;
      version: string;
    };
    
    listen(port: number): Promise<void>;
    close(): Promise<void>;
    
    transport: any;
    setTransport(transport: any): void;
    connect(transport: any): Promise<void>;
    
    setRequestHandler(options: { method: string }, handler: (request: any) => Promise<any>): void;
  }
}

declare module '@modelcontextprotocol/sdk/transport' {
  export class SSETransport {
    constructor(url: string);
    
    connect(url: string): Promise<void>;
    stop(): Promise<void>;
    start(): Promise<void>;
    send(message: any): Promise<void>;
    
    onmessage: ((message: any) => void) | null;
    onerror: ((error: Error) => void) | null;
    onclose: (() => void) | null;
  }
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export interface JSONRPCMessage {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: any;
  }

  export interface JSONRPCRequest extends JSONRPCMessage {
    id: string | number;
  }

  export interface JSONRPCResponse {
    jsonrpc: "2.0";
    id: string | number;
    result?: any;
    error?: {
      code: number;
      message: string;
      data?: any;
    };
  }

  export interface JSONRPCNotification {
    jsonrpc: "2.0";
    method: string;
    params?: any;
  }
} 