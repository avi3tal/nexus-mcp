import express from 'express';
import { SSETransport } from '../transport/SSETransport.js';
import { TransportError } from '../transport/TransportError.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

async function runTest() {
  console.log('Starting test environment...');

  // Create mock server
  const app = express();
  const port = 3000;
  const clients = new Set<express.Response>();

  // SSE endpoint
  app.get('/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    clients.add(res);
    req.on('close', () => clients.delete(res));

    const message: JSONRPCMessage = {
      jsonrpc: '2.0',
      method: 'connected',
      params: { status: 'connected' }
    };
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  });

  // Message endpoint
  app.post('/sse', express.json(), (req, res) => {
    const message = req.body as { jsonrpc: '2.0', method: string, params?: Record<string, unknown> };
    const response: JSONRPCMessage = {
      jsonrpc: '2.0',
      method: 'echo',
      params: message.params ?? {}
    };

    clients.forEach(client => {
      client.write(`data: ${JSON.stringify(response)}\n\n`);
    });

    res.json({ status: 'ok' });
  });

  // Request endpoint
  app.post('/request', express.json(), (req, res) => {
    const message = req.body as { jsonrpc: '2.0', id: number, method: string, params?: Record<string, unknown> };
    const response = {
      jsonrpc: '2.0',
      id: message.id,
      result: { echo: message.params ?? {} }
    };
    res.json(response);
  });

  // Start server
  const server = app.listen(port, () => {
    console.log(`Mock server running at http://localhost:${port}`);
  });

  try {
    // Create transport
    const transport = new SSETransport('http://localhost:3000/sse', {
      'Accept': 'text/event-stream',
      'Connection': 'keep-alive'
    }, {
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 5000
    });

    // Set up handlers
    let messageReceived = false;
    transport.onmessage = (message) => {
      console.log('Received:', message);
      messageReceived = true;
    };

    transport.onerror = (error) => {
      console.error('Error:', error);
    };

    transport.onclose = () => {
      console.log('Closed');
    };

    // Test connection
    console.log('Connecting...');
    await transport.start();
    console.log('Connected');

    // Wait for connection message with timeout
    await Promise.race([
      new Promise<void>(resolve => {
        const checkMessage = () => {
          if (messageReceived) {
            resolve();
          } else {
            setTimeout(checkMessage, 100);
          }
        };
        checkMessage();
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for connection message')), 5000))
    ]);

    // Test message
    const message: JSONRPCMessage = {
      jsonrpc: '2.0',
      method: 'test',
      params: { test: 'data' }
    };

    console.log('Sending:', message);
    await transport.send(message);

    // Wait for echo response
    messageReceived = false;
    await Promise.race([
      new Promise<void>(resolve => {
        const checkMessage = () => {
          if (messageReceived) {
            resolve();
          } else {
            setTimeout(checkMessage, 100);
          }
        };
        checkMessage();
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for echo response')), 5000))
    ]);

    // Test request
    const request: JSONRPCMessage & { id: number } = {
      jsonrpc: '2.0',
      id: 1,
      method: 'testRequest',
      params: { test: 'request' }
    };

    console.log('Requesting:', request);
    const response = await transport.request(request);
    console.log('Response:', response);

    // Clean up
    await transport.close();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });

  } catch (error) {
    console.error('Test failed:', error);
    server.close(() => {
      process.exit(1);
    });
  }
}

runTest(); 