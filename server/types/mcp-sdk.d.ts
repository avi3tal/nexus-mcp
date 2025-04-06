declare module '@modelcontextprotocol/sdk/server' {
  export class Server {
    constructor(info: any, options: any);
    connect(transport: any): Promise<void>;
    close?(): Promise<void>;
    setRequestHandler(schema: any, handler: (request: any) => Promise<any>): void;
  }
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export interface JSONRPCMessage {
    jsonrpc: '2.0';
    id: string | number;
    method?: string;
    params?: any;
    result?: any;
    error?: any;
  }
  
  export interface JSONRPCResponse extends JSONRPCMessage {
    result: any;
  }
}

// Add declarations for SSETransport
declare module '../transport/SSETransport.js' {
  export class SSETransport {
    constructor(url: string, headers?: Record<string, string>, options?: any);
    start(): Promise<void>;
    stop(): Promise<void>;
    onerror?: (error: Error) => void;
    onclose?: () => void;
  }
} 