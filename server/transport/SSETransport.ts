import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Transport } from './Transport.js';
import { TransportError, TransportErrorCode } from './TransportError.js';
import type { JSONRPCMessage, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';

interface SSETransportOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  authToken?: string;
}

export class SSETransport implements Transport {
  private transport: SSEClientTransport;
  private url: URL;
  private headers: Record<string, string>;
  private options: Required<SSETransportOptions>;
  private retryCount = 0;
  private reconnectTimeout?: NodeJS.Timeout;
  private isConnected = false;
  private messageQueue: JSONRPCMessage[] = [];
  private messageHandlers = new Map<number | string, (response: JSONRPCResponse) => void>();

  // Store the original onmessage handler set by the user
  private userOnMessageHandler?: (message: JSONRPCMessage) => void;

  constructor(
    url: string,
    headers: Record<string, string> = {},
    options: SSETransportOptions = {}
  ) {
    this.url = new URL(url);
    this.headers = {
      Accept: 'text/event-stream',
      Connection: 'keep-alive',
      ...headers
    };
    if (options.authToken) {
      this.headers.Authorization = `Bearer ${options.authToken}`;
    }
    this.options = {
      maxRetries: options.maxRetries ?? 5,
      retryDelay: options.retryDelay ?? 1000,
      timeout: options.timeout ?? 30000,
      authToken: options.authToken ?? ''
    };

    this.transport = this.createTransport();
  }

  private setupInternalEventHandlers(targetTransport: SSEClientTransport): void {
    // Internal handler to process messages for response routing ONLY
    targetTransport.onmessage = (message: JSONRPCMessage) => {
      console.log("SSETransport (internal): Received message", message);
      
      // Route responses to specific request handlers
      if ('id' in message && (typeof message.id === 'number' || typeof message.id === 'string')) {
        const handler = this.messageHandlers.get(message.id);
        if (handler) {
          console.log(`SSETransport: Routing response for id ${message.id} to handler.`);
          handler(message as JSONRPCResponse); // Assume it's a response if ID matches
          this.messageHandlers.delete(message.id);
        }
      }

      // Call the user-defined message handler if it exists
      if (this.userOnMessageHandler) {
        console.log("SSETransport: Calling userOnMessageHandler.");
        this.userOnMessageHandler(message);
      }
    };

    // Handle errors
    targetTransport.onerror = (error: Error) => {
      console.error("SSETransport: Error received", error);
      this.isConnected = false;
      if (this.userOnErrorHandler) {
        this.userOnErrorHandler(error); // Forward to user handler
      }
    };

    // Handle close
    targetTransport.onclose = () => {
      console.log("SSETransport: Connection closed.");
      this.isConnected = false;
      if (this.userOnCloseHandler) {
        this.userOnCloseHandler(); // Forward to user handler
      }
    };
  }

  private createTransport(): SSEClientTransport {
    console.log("SSETransport: Creating new SSEClientTransport instance (no connectionId logic).");
    if (this.transport) {
      this.transport.onmessage = undefined;
      this.transport.onerror = undefined;
      this.transport.onclose = undefined;
    }
    const newTransport = new SSEClientTransport(this.url, {
      eventSourceInit: {
        fetch: (url: string | URL, init?: RequestInit) =>
          fetch(url, { ...init, headers: this.headers })
      },
      requestInit: {
        headers: this.headers // Headers will NOT include x-connection-id
      }
    });
    this.setupInternalEventHandlers(newTransport);
    return newTransport;
  }
  
  private async attemptReconnect(): Promise<void> {
     if (this.retryCount >= this.options.maxRetries) {
        console.error("SSETransport: Max retries exceeded during reconnect.");
        throw TransportError.fromError(
            new Error('Max retries exceeded'),
            TransportErrorCode.RECONNECTION_FAILED
        );
    }

    this.retryCount++;
    const delay = this.options.retryDelay * Math.pow(2, this.retryCount - 1); 
    console.log(`SSETransport: Attempting reconnect #${this.retryCount} in ${delay}ms...`);
    await new Promise(resolve => {
        this.reconnectTimeout = setTimeout(resolve, delay);
    });

    try {
        this.transport = this.createTransport();
        await this.start(); 
        console.log("SSETransport: Reconnect successful.");
        this.retryCount = 0; 
        await this.processMessageQueue(); // Process queue on successful reconnect
    } catch (error) {
        console.error(`SSETransport: Reconnect attempt #${this.retryCount} failed.`, error);
        if (this.retryCount < this.options.maxRetries) {
          await this.attemptReconnect(); 
        } else {
          throw error; 
        }
    }
}


  async start(): Promise<void> {
    if (this.isConnected) {
      console.log("SSETransport: start() called but already connected.");
      return;
    }
    console.log("SSETransport: Calling transport.start() (no connectionId logic)...");
    try {
      await this.transport.start(); 
      this.isConnected = true;
      console.log("SSETransport: transport.start() completed, isConnected=true. Processing queue...");
      await this.processMessageQueue(); // Process queue immediately on connect
    } catch (error) {
      console.error("SSETransport: Error during transport.start()", error);
      this.isConnected = false;
      if (error instanceof TransportError && error.retryable) {
        console.log("SSETransport: Attempting reconnect after start error...");
        await this.attemptReconnect(); 
      } else {
        throw error; 
      }
    }
  }

  private async processMessageQueue(): Promise<void> {
    console.log(`SSETransport: Processing message queue (${this.messageQueue.length} items)...`);
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        console.log("SSETransport: Sending queued message:", message);
        await this.sendInternal(message); 
      }
    }
    console.log(`SSETransport: Message queue processed.`);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // Only queue if not connected
    if (!this.isConnected) { 
      console.log(`SSETransport: Queuing message (isConnected: ${this.isConnected}):`, message);
      this.messageQueue.push(message);
      // Trigger connection sequence if not already started/connecting
      // Note: This might still lead to race conditions if start() hasn't completed
      // but for the single-connection server, immediate start might be okay.
      this.start().catch(err => console.error("SSETransport: Background start failed", err));
      return; 
    }
    // If connected, send immediately
    await this.sendInternal(message);
  }

  // Internal send assumes connection is established
  private async sendInternal(message: JSONRPCMessage): Promise<void> {
    try {
      // Send the message exactly as received, DO NOT add connectionId
      console.log("SSETransport: Sending message (no connectionId added):", message);
      // Cast to the expected SDK type
      const sdkMessage = {
        jsonrpc: message.jsonrpc,
        method: message.method || "notification", // Ensure method is never undefined
        id: message.id,
        params: message.params
      };
      await this.transport.send(sdkMessage);
      console.log("SSETransport: Message sent successfully.");
    } catch (error) {
      console.error("SSETransport: Error during sendInternal()", error);
      if (error instanceof Error) {
        throw TransportError.fromError(error, TransportErrorCode.MESSAGE_SEND_FAILED);
      }
      throw error;
    }
  }

  private userOnErrorHandler?: (error: Error) => void;
  private userOnCloseHandler?: () => void;

  set onmessage(callback: ((message: JSONRPCMessage) => void) | undefined) {
    console.log("SSETransport: User 'onmessage' handler being set.");
    this.userOnMessageHandler = callback;
  }

  get onmessage(): ((message: JSONRPCMessage) => void) | undefined {
    return this.userOnMessageHandler;
  }

  set onerror(callback: ((error: Error) => void) | undefined) {
    console.log("SSETransport: User 'onerror' handler being set.");
    this.userOnErrorHandler = callback;
  }

  get onerror(): ((error: Error) => void) | undefined {
    return this.userOnErrorHandler;
  }

  set onclose(callback: (() => void) | undefined) {
    console.log("SSETransport: User 'onclose' handler being set.");
    this.userOnCloseHandler = callback;
  }

  get onclose(): (() => void) | undefined {
    return this.userOnCloseHandler;
  }

  async request(message: JSONRPCMessage & { id: number | string }): Promise<JSONRPCResponse> { 
    // Ensure connection is started before attempting request
    if (!this.isConnected) {
        await this.start();
    }

    return new Promise((resolve, reject) => {
      const messageId = message.id; 
      const handler = (response: JSONRPCResponse) => {
        if ('error' in response && response.error && typeof response.error === 'object' && 'message' in response.error) { 
          console.error(`SSETransport: Request ${messageId} failed:`, response.error);
          const errorMessage = typeof response.error.message === 'string' ? response.error.message : 'Unknown error';
          reject(TransportError.fromError(new Error(errorMessage), TransportErrorCode.MESSAGE_SEND_FAILED, response.error));
        } else if ('error' in response && response.error) {
          console.error(`SSETransport: Request ${messageId} failed with non-standard error:`, response.error);
           reject(TransportError.fromError(new Error('Request failed with non-standard error'), TransportErrorCode.MESSAGE_SEND_FAILED, response.error));
        } else {
          console.log(`SSETransport: Request ${messageId} succeeded.`);
          resolve(response);
        }
      };
      this.messageHandlers.set(messageId, handler);

      console.log(`SSETransport: Sending request ${messageId} (no connectionId added):`, message);
      this.sendInternal(message).catch(err => {
        console.error(`SSETransport: Failed to send request ${messageId}:`, err);
        this.messageHandlers.delete(messageId);
        reject(err);
      });

      const timeoutHandle = setTimeout(() => {
        if (this.messageHandlers.has(messageId)) {
          console.error(`SSETransport: Request ${messageId} timed out.`);
          this.messageHandlers.delete(messageId);
          reject(new Error(`Request ${messageId} timed out`));
        }
      }, this.options.timeout); 
      
      this.messageHandlers.set(messageId, (response) => {
          clearTimeout(timeoutHandle);
          handler(response);
      });
    });
  }

   get isTransportConnected(): boolean {
    return this.isConnected;
  }

  async close(): Promise<void> {
    console.log("SSETransport: close() called.");
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    this.isConnected = false;
    this.messageQueue = []; 
    if (this.transport) { 
        await this.transport.close();
    }
  }
} 