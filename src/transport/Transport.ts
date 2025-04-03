import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface Transport {
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
} 