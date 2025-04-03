import { SSETransport } from '../transport/SSETransport.js';
import { TransportError } from '../transport/TransportError.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export async function testSSETransport() {
  console.log('Starting SSE Transport test...');

  // Test with a mock SSE server URL
  const testUrl = 'http://localhost:3000/sse';
  const transport = new SSETransport(testUrl, {
    'Accept': 'text/event-stream',
    'Connection': 'keep-alive'
  }, {
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 5000
  });

  // Set up event handlers
  transport.onmessage = (message) => {
    console.log('Received message:', message);
  };

  transport.onerror = (error) => {
    console.error('Transport error:', error);
  };

  transport.onclose = () => {
    console.log('Transport closed');
  };

  try {
    console.log('Attempting to connect...');
    await transport.start();
    console.log('Connected successfully');

    // Wait for initial connection message
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test sending a message
    const testMessage: JSONRPCMessage = {
      jsonrpc: '2.0',
      method: 'test',
      params: { test: 'data' }
    };

    console.log('Sending test message:', testMessage);
    await transport.send(testMessage);

    // Wait for echo response
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test request/response
    const requestMessage: JSONRPCMessage & { id: number } = {
      jsonrpc: '2.0',
      id: 1,
      method: 'testRequest',
      params: { test: 'request' }
    };

    console.log('Sending request:', requestMessage);
    const response = await transport.request(requestMessage);
    console.log('Received response:', response);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));

  } catch (error) {
    if (error instanceof TransportError) {
      console.error('Transport error:', error.message);
      console.error('Error code:', error.code);
      console.error('Retryable:', error.retryable);
    } else {
      console.error('Unexpected error:', error);
    }
    throw error;
  } finally {
    console.log('Closing transport...');
    await transport.close();
  }
}

// Run the test
testSSETransport().catch(console.error); 