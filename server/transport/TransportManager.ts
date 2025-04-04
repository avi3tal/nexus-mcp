import { SSETransport } from './SSETransport.js';
import { Transport } from './Transport.js';
import { TransportError, TransportErrorCode } from './TransportError.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

interface TransportManagerOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class TransportManager {
  private transports: Map<string, Transport> = new Map();
  private options: Required<TransportManagerOptions>;

  constructor(options: TransportManagerOptions = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? 5,
      retryDelay: options.retryDelay ?? 1000,
      timeout: options.timeout ?? 30000
    };
  }

  async connect(
    url: string,
    id: string,
    headers: HeadersInit = {}
  ): Promise<Transport> {
    const existingTransport = this.transports.get(id);
    if (existingTransport) {
      // Check if the existing transport is actually connected (e.g., SSETransport has an isConnected property)
      if ((existingTransport as SSETransport).isTransportConnected) { 
        console.log(`TransportManager: Returning existing connected transport for id ${id}`);
        return existingTransport;
      } else {
        // If it exists but isn't connected, remove it before creating a new one
        console.warn(`TransportManager: Found existing but disconnected transport for id ${id}. Removing before reconnecting.`);
        await this.disconnect(id); // Ensure cleanup before proceeding
      }
    }

    console.log(`TransportManager: Creating new transport connection for id ${id} at ${url}`);
    const headersRecord = Object.fromEntries(new Headers(headers).entries());
    const transport = new SSETransport(url, headersRecord, this.options);
    
    try {
      await transport.start();
      this.transports.set(id, transport);

      // Setup default handlers - these can be overridden later if needed
      transport.onclose = () => {
        console.log(`TransportManager: Default onclose handler for ${id}. Removing transport.`);
        this.transports.delete(id);
        // Maybe notify config manager to update status?
      };
      transport.onerror = (error) => {
        console.error(`TransportManager: Default onerror handler for ${id}:`, error);
        if (error instanceof TransportError && !error.retryable) {
          console.log(`TransportManager: Non-retryable error for ${id}. Removing transport.`);
          this.transports.delete(id);
        }
      };

      return transport;
    } catch (error) {
      console.error(`TransportManager: Failed to start transport for ${id}:`, error);
      // Ensure transport isn't left in the map if start fails
      this.transports.delete(id);
      if (error instanceof Error) {
        throw TransportError.connectionFailed(url, error);
      }
      throw error;
    }
  }

  async disconnect(id: string): Promise<void> {
    const transport = this.transports.get(id);
    if (transport) {
      try {
        await transport.close();
      } catch (error) {
        console.error(`Error disconnecting transport ${id}:`, error);
      } finally {
        this.transports.delete(id);
      }
    }
  }

  getTransport(id: string): Transport | undefined {
    return this.transports.get(id);
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.transports.entries()).map(
      async ([id, transport]) => {
        try {
          await transport.close();
        } catch (error) {
          console.error(`Error disconnecting transport ${id}:`, error);
        }
      }
    );

    await Promise.all(disconnectPromises);
    this.transports.clear();
  }

  isConnected(id: string): boolean {
    return this.transports.has(id);
  }

  getConnectedIds(): string[] {
    return Array.from(this.transports.keys());
  }

  /**
   * Send a JSON-RPC request through a transport and wait for the response
   * @param id Server ID
   * @param message JSON-RPC request message
   * @returns JSON-RPC response
   */
  async request(id: string, message: JSONRPCMessage & { id: string }): Promise<JSONRPCMessage> {
    const transport = this.getTransport(id);
    if (!transport) {
      throw new TransportError(
        `No transport found for id ${id}`,
        TransportErrorCode.NOT_CONNECTED,
        { id },
        false
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TransportError(
          `Request timed out after ${this.options.timeout}ms`,
          TransportErrorCode.TIMEOUT,
          { id, messageId: message.id },
          true
        ));
      }, this.options.timeout);

      // Set up one-time message handler to catch the response
      const originalOnMessage = transport.onmessage;
      transport.onmessage = (response: JSONRPCMessage) => {
        // Check if this is the response we're waiting for
        if ('id' in response && response.id === message.id) {
          // Restore original handler
          transport.onmessage = originalOnMessage;
          clearTimeout(timeoutId);
          
          if ('error' in response) {
            reject(new TransportError(
              `JSON-RPC error: ${response.error.message}`,
              TransportErrorCode.RPC_ERROR,
              { id, messageId: message.id, error: response.error },
              true
            ));
          } else {
            resolve(response);
          }
        } else if (originalOnMessage) {
          // Pass other messages to the original handler
          originalOnMessage(response);
        }
      };

      // Send the request
      transport.send(message).catch(error => {
        transport.onmessage = originalOnMessage;
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }
} 