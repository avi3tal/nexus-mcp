import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const app = express();
app.use(express.json());

// Store active connections
const activeConnections = new Map<string, { transport: SSEServerTransport }>();

// Create a new server instance for each connection
app.get("/sse", async (req, res) => {
  const connectionId = Date.now().toString();
  console.log(`Received connection: ${connectionId}`);
  
  try {
    // Set SSE headers first
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const transport = new SSEServerTransport("/message", res);
    
    // Store the connection
    activeConnections.set(connectionId, { transport });
    
    // Set up error handling for the response
    res.on('close', () => {
      console.log(`Client disconnected: ${connectionId}`);
      activeConnections.delete(connectionId);
    });
    
    // Store the connection ID in the request object
    req.transport = transport;
    req.connectionId = connectionId;
    
    // Send a comment to establish the connection
    res.write('data: connected\n\n');
    
  } catch (error) {
    console.error(`Error setting up connection: ${connectionId}`, error);
    if (!res.headersSent) {
      res.status(500).send('Error setting up connection');
    }
  }
});

// Handle messages
app.post("/message", async (req, res) => {
  const connectionId = req.connectionId;
  console.log(`Received message for connection: ${connectionId}`);
  
  if (!connectionId) {
    res.status(400).send('Missing connection ID');
    return;
  }

  const connection = activeConnections.get(connectionId);
  if (!connection) {
    res.status(404).send('Connection not found');
    return;
  }

  try {
    await connection.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error(`Error handling message for connection: ${connectionId}`, error);
    if (!res.headersSent) {
      res.status(500).send('Error handling message');
    }
  }
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  // Clean up all connections
  for (const [connectionId] of activeConnections.entries()) {
    console.log(`Cleaning up connection: ${connectionId}`);
    activeConnections.delete(connectionId);
  }
  process.exit(0);
});

// Start the server
const port = 3001;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 