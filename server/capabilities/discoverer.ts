import { TransportManager } from '../transport/manager.js';
import { CapabilityRegistry } from './registry.js';
import { CapabilityError } from './errors.js';
import { JSONRPCMessage, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';
import { Transport } from '../transport/Transport.js';
import { SSETransport } from '../transport/SSETransport.js';
import { Tool, Prompt } from './types.js'; // Import adapted types

export class CapabilityDiscoverer {
  constructor(
    private transportManager: TransportManager,
    private registry: CapabilityRegistry
  ) {}

  async discoverCapabilities(serverId: string): Promise<void> {
    console.log(`CapabilityDiscoverer: Starting capability discovery for server: ${serverId}`);
    const transport = this.transportManager.getTransport(serverId);
    if (!transport) {
      console.error(`CapabilityDiscoverer: Transport not found for server: ${serverId}`);
      throw CapabilityError.serverNotFound(serverId);
    }

    // Connect if needed (no connectionId check required for this server version)
    try {
      // Use the isTransportConnected getter
      if (!(transport as SSETransport).isTransportConnected) {
          console.log(`CapabilityDiscoverer: Transport for ${serverId} not connected, calling start()...`);
          await transport.start();
          console.log(`CapabilityDiscoverer: transport.start() for ${serverId} completed.`);
      } else {
          console.log(`CapabilityDiscoverer: Transport for ${serverId} already connected.`);
      }
    } catch (error) {
        console.error(`CapabilityDiscoverer: Failed during transport start for server ${serverId}:`, error);
        throw CapabilityError.discoveryFailed(serverId, new Error(`Failed to start transport: ${error instanceof Error ? error.message : String(error)}`));
    }
    
    // REMOVE ensureConnectionIdReady call

    try {
      console.log(`CapabilityDiscoverer: Discovering tools for server: ${serverId}`);
      await this.discoverTools(transport, serverId);
      
      console.log(`CapabilityDiscoverer: Discovering prompts for server: ${serverId}`);
      await this.discoverPrompts(transport, serverId);
      
      console.log(`CapabilityDiscoverer: Capability discovery completed for server: ${serverId}`);
    } catch (error) {
      console.error(`CapabilityDiscoverer: Capability discovery failed during tool/prompt fetching for server: ${serverId}`, error);
      if (error instanceof CapabilityError) {
        throw error;
      }
      throw CapabilityError.discoveryFailed(serverId, error);
    }
  }

  private async discoverTools(transport: Transport, serverId: string): Promise<void> {
     // No need for instanceof check as request is gone from base Transport
    
    console.log(`CapabilityDiscoverer: Sending tools/list request to server: ${serverId}`);
    const toolsMessage: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: `tools-list-${Date.now()}`, 
      method: 'tools/list',
      params: {}
    };

    try {
      // We need to manually handle the request/response now
      const response = await this.manualRequestResponse(transport, toolsMessage as JSONRPCMessage & { id: string });
      console.log(`CapabilityDiscoverer: Received tools/list response from server: ${serverId}`, response);
      
      if (!response || typeof response.result !== 'object' || response.result === null || !Array.isArray((response.result as any).tools)) {
          console.error(`CapabilityDiscoverer: Invalid tools/list response structure for server ${serverId}:`, response);
          throw new Error('Invalid response structure for tools/list');
      }
      
      const tools = (response.result as any).tools;
      for (const toolData of tools) {
          console.log(`CapabilityDiscoverer: Registering tool data from server: ${serverId}`, toolData);
          // Adapt the received data to what the (adapted) ToolSchema expects
          const toolToRegister: Tool = {
              name: toolData.name,
              description: toolData.description,
              inputSchema: toolData.inputSchema, // Expecting inputSchema now
              source: serverId
          };
          this.registry.registerTool(toolToRegister);
      }
    } catch (error) {
        console.error(`CapabilityDiscoverer: Failed to discover tools for server ${serverId}:`, error);
        throw CapabilityError.toolsDiscoveryFailed(serverId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async discoverPrompts(transport: Transport, serverId: string): Promise<void> {
    // No need for instanceof check
    
    console.log(`CapabilityDiscoverer: Sending prompts/list request to server: ${serverId}`);
    const promptsMessage: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: `prompts-list-${Date.now()}`, 
      method: 'prompts/list',
      params: {}
    };

     try {
      const response = await this.manualRequestResponse(transport, promptsMessage as JSONRPCMessage & { id: string });
      console.log(`CapabilityDiscoverer: Received prompts/list response from server: ${serverId}`, response);

      if (!response || typeof response.result !== 'object' || response.result === null || !Array.isArray((response.result as any).prompts)) {
          console.error(`CapabilityDiscoverer: Invalid prompts/list response structure for server ${serverId}:`, response);
          throw new Error('Invalid response structure for prompts/list');
      }
      
      const prompts = (response.result as any).prompts;
      for (const promptData of prompts) {
          console.log(`CapabilityDiscoverer: Registering prompt data from server: ${serverId}`, promptData);
          // Adapt the received data to what the (adapted) PromptSchema expects
           const promptToRegister: Prompt = {
              name: promptData.name,
              description: promptData.description,
              template: promptData.template, // Will be undefined, but schema allows it
              arguments: promptData.arguments, // Pass through if present
              source: serverId
          };
          this.registry.registerPrompt(promptToRegister);
      }
    } catch (error) {
        console.error(`CapabilityDiscoverer: Failed to discover prompts for server ${serverId}:`, error);
        throw CapabilityError.promptsDiscoveryFailed(serverId, error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  // Helper to manually handle request/response pairing since transport.request is removed
  private async manualRequestResponse(transport: Transport, requestMessage: JSONRPCMessage & { id: string | number }): Promise<JSONRPCResponse> {
      return new Promise((resolve, reject) => {
          const messageId = requestMessage.id;
          // Get method name safely for logging/error messages
          const methodName = ('method' in requestMessage) ? requestMessage.method : 'unknown method'; 
          
          let originalOnMessage = (transport as any).userOnMessageHandler; // Access the stored user handler

          const timeout = setTimeout(() => {
              (transport as any).userOnMessageHandler = originalOnMessage; // Restore original handler on timeout
              reject(new Error(`Timeout waiting for response to ${methodName} (id: ${messageId})`));
          }, 10000); // Example timeout

          // Temporarily override the user handler
          (transport as any).userOnMessageHandler = (message: JSONRPCMessage) => {
              let handled = false;
              if ('id' in message && message.id === messageId) {
                  console.log(`CapabilityDiscoverer: Received matching response for id ${messageId}:`, message);
                  clearTimeout(timeout);
                  (transport as any).userOnMessageHandler = originalOnMessage; // Restore original handler
                  resolve(message as JSONRPCResponse);
                  handled = true;
              } 
              // If it wasn't the response we were waiting for, pass it to the original handler if one exists
              if (!handled && originalOnMessage) {
                 originalOnMessage(message);
              }
          };
          
          // Send the request
          transport.send(requestMessage).catch(err => {
              clearTimeout(timeout);
              (transport as any).userOnMessageHandler = originalOnMessage; // Restore on send error too
              reject(err); // Reject the promise if sending fails
          });
      });
  }

} 