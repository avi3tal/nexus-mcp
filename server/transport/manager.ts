import { Transport } from './Transport.js';
import { SSETransport } from './SSETransport.js';
import { TransportError, TransportErrorCode } from './TransportError.js';
import type { JSONRPCMessage, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';

interface TransportManagerOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class TransportManager {
  private transports: Map<string, Transport> = new Map();
  private options: Required<TransportManagerOptions>;
  private connectedIds: Set<string> = new Set();

  constructor(options: TransportManagerOptions = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? 5,
      retryDelay: options.retryDelay ?? 1000,
      timeout: options.timeout ?? 30000 // Added default timeout
    };
  }

  getTransport(serverId: string): Transport | null {
    return this.transports.get(serverId) ?? null;
  }

  addTransport(serverId: string, transport: Transport): void {
    this.transports.set(serverId, transport);
    // Optionally set default handlers here if not done in connect
    transport.onclose = () => {
      console.log(`TransportManager: Default onclose handler for ${serverId}. Removing transport.`);
      this.removeTransport(serverId);
    };
    transport.onerror = (error) => {
      console.error(`TransportManager: Default onerror handler for ${serverId}:`, error);
      if (error instanceof TransportError && !error.retryable) {
         console.log(`TransportManager: Non-retryable error for ${serverId}. Removing transport.`);
         this.removeTransport(serverId);
      }
    };
  }

  removeTransport(serverId: string): void {
    this.transports.delete(serverId);
    this.connectedIds.delete(serverId);
  }

  async connect(serverId: string): Promise<void> {
    const transport = this.getTransport(serverId);
    if (!transport) throw new Error(`Transport not found for server ${serverId}`);
    
    // Idempotency check - If already connected, maybe just return?
    if (this.isConnected(serverId)) {
        console.log(`TransportManager: Transport for ${serverId} already connected.`);
        // Potentially re-run start if needed? Or just assume it's okay.
        // await transport.start(); // Be cautious with calling start multiple times
        return;
    }
    
    console.log(`TransportManager: Starting connection for ${serverId}...`);
    await transport.start();
    this.connectedIds.add(serverId);
    console.log(`TransportManager: Connection established for ${serverId}.`);
  }

  async disconnect(serverId: string): Promise<void> {
    const transport = this.getTransport(serverId);
    if (transport) { // Check if transport exists before trying to close
      console.log(`TransportManager: Closing connection for ${serverId}...`);
      await transport.close();
      this.removeTransport(serverId); // Use removeTransport to handle map and set cleanup
      console.log(`TransportManager: Connection closed for ${serverId}.`);
    } else {
      console.warn(`TransportManager: disconnect called for non-existent transport ${serverId}`);
      // Still ensure it's removed from connected set if somehow present
      this.connectedIds.delete(serverId);
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.transports.keys());
    await Promise.all(ids.map(id => this.disconnect(id)));
  }

  isConnected(serverId: string): boolean {
    // Rely on the connectedIds set, which is updated by connect/disconnect
    return this.connectedIds.has(serverId);
  }

  getConnectedIds(): string[] {
    return Array.from(this.connectedIds);
  }
  
  /**
   * Send a JSON-RPC request through a transport and wait for the response
   * @param serverId Server ID
   * @param message JSON-RPC request message with a unique ID
   * @returns JSON-RPC response
   */
  async request(serverId: string, message: JSONRPCMessage & { id: string | number }): Promise<JSONRPCResponse> {
    const transport = this.getTransport(serverId);
    if (!transport) {
      throw new TransportError(
        `No transport found for id ${serverId}`,
        TransportErrorCode.NOT_CONNECTED,
        { serverId },
        false
      );
    }
    
    // Ensure transport is actually connected before sending
    if (!this.isConnected(serverId)) {
        throw new TransportError(
          `Transport for ${serverId} is not connected.`,
          TransportErrorCode.NOT_CONNECTED,
          { serverId },
          false
        );
    }

    return new Promise((resolve, reject) => {
      const messageId = message.id;
      const methodName = ('method' in message) ? message.method : 'unknown method';
      
      console.log(`TransportManager: Sending request ${methodName} (id: ${messageId}) to ${serverId}`);

      const timeoutId = setTimeout(() => {
        // Clean up the temporary handler on timeout
        if (transport.onmessage === tempOnMessage) {
          transport.onmessage = originalOnMessage; 
        }
        reject(new TransportError(
          `Request timed out after ${this.options.timeout}ms for ${methodName} (id: ${messageId})`,
          TransportErrorCode.TIMEOUT,
          { serverId, messageId },
          true // Timeout might be temporary
        ));
      }, this.options.timeout);

      // Store the original handler
      const originalOnMessage = transport.onmessage;

      // Define the temporary handler
      const tempOnMessage = (response: JSONRPCMessage) => {
        if ('id' in response && response.id === messageId) {
          console.log(`TransportManager: Received matching response for id ${messageId} from ${serverId}`);
          clearTimeout(timeoutId);
          transport.onmessage = originalOnMessage; // Restore original handler
          
          if ('error' in response && response.error) {
            console.error(`TransportManager: RPC Error response for id ${messageId} from ${serverId}:`, response.error);
            reject(new TransportError(
              `JSON-RPC error: ${response.error.message}`,
              TransportErrorCode.RPC_ERROR,
              { serverId, messageId, error: response.error },
              false // RPC errors are usually not retryable at this level
            ));
          } else {
            resolve(response as JSONRPCResponse);
          }
        } else if (originalOnMessage) {
          // Pass other messages to the original handler if it exists
          // console.log(`TransportManager: Passing unrelated message to original handler for ${serverId}`);
          originalOnMessage(response);
        }
      };

      // Set the temporary handler
      transport.onmessage = tempOnMessage;

      // Send the request
      transport.send(message).catch(error => {
        console.error(`TransportManager: Failed to send message (id: ${messageId}) to ${serverId}:`, error);
        clearTimeout(timeoutId);
        transport.onmessage = originalOnMessage; // Restore original handler on send error
        reject(error); // Reject the promise if sending fails
      });
    });
  }
} 