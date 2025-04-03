import express from 'express';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

const app = express();
const port = 3000;

// Store connected clients
const clients = new Set<express.Response>();

app.get('/sse', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Add client to set
  clients.add(res);

  // Handle client disconnect
  req.on('close', () => {
    clients.delete(res);
  });

  // Send initial connection message
  const message: JSONRPCMessage = {
    jsonrpc: '2.0',
    method: 'connected',
    params: { status: 'connected' }
  };
  res.write(`data: ${JSON.stringify(message)}\n\n`);
});

// Handle test messages
app.post('/test', express.json(), (req, res) => {
  const message = req.body as { jsonrpc: '2.0', method: string, params?: Record<string, unknown> };
  
  // Echo back to all clients
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

// Handle test requests
app.post('/request', express.json(), (req, res) => {
  const message = req.body as { jsonrpc: '2.0', id: number, method: string, params?: Record<string, unknown> };
  
  // Send response
  const response = {
    jsonrpc: '2.0',
    id: message.id,
    result: { echo: message.params ?? {} }
  };

  res.json(response);
});

// Handle SSE messages
app.post('/sse', express.json(), (req, res) => {
  const message = req.body as { jsonrpc: '2.0', method: string, params?: Record<string, unknown> };
  
  // Echo back to all clients
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

const server = app.listen(port, () => {
  console.log(`Mock SSE server running at http://localhost:${port}`);
});

export { server as mockSSEServer }; 