# MCP SSE Implementation Guide

This guide explains how to implement MCP (Model Context Protocol) using Server-Sent Events (SSE) transport in TypeScript.

## Overview

MCP over SSE provides a reliable way to establish bidirectional communication between clients and servers. The protocol uses:
- SSE for server-to-client streaming
- HTTP POST for client-to-server messages
- JSON-RPC for message format

## Core Components

### 1. Common Types

```typescript
interface JSONRPCMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface Resource {
  uri: string;
  name: string;
  type: string;
  content?: string;
}

interface MCPCapabilities {
  resources: {
    supported?: boolean;
    types?: string[];
  };
}

interface InitializeParams {
  protocolVersion: string;
  capabilities: MCPCapabilities;
}

interface InitializeResult {
  protocolVersion: string;
  capabilities: MCPCapabilities;
}
```

### 2. Server Implementation

```typescript
class MCPServer {
  private connections = new Map<string, express.Response>();
  private resources = new Map<string, Resource>();
  private authToken?: string;

  constructor(options: { authToken?: string } = {}) {
    this.authToken = options.authToken;
  }

  createExpressApp() {
    const app = express();

    // Authentication middleware
    const authMiddleware = (req: express.Request, res: express.Response, next: express.Function) => {
      if (this.authToken) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token !== this.authToken) {
          res.status(401).send('Unauthorized');
          return;
        }
      }
      next();
    };

    // SSE endpoint
    app.get('/sse', authMiddleware, (req, res) => {
      const connectionId = randomUUID();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Send endpoint for POST messages
      res.write(`event: endpoint\ndata: ${JSON.stringify({
        endpoint: '/message',
        sessionId: connectionId
      })}\n\n`);

      this.connections.set(connectionId, res);

      req.on('close', () => {
        this.connections.delete(connectionId);
      });
    });

    // Message endpoint
    app.post('/message', authMiddleware, express.json(), async (req, res) => {
      const message: JSONRPCMessage = req.body;
      
      try {
        const response = await this.handleMessage(message);
        if (response) {
          const connectionId = req.query.sessionId as string;
          const connection = this.connections.get(connectionId);
          if (connection) {
            connection.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
          }
        }
        res.status(202).send('Accepted');
      } catch (error) {
        res.status(400).json({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: error.message
          }
        });
      }
    });

    return app;
  }
}
```

### 3. Client Implementation

```typescript
class MCPClient {
  private eventSource?: EventSource;
  private messageEndpoint?: string;
  private nextMessageId = 1;
  private messageHandlers = new Map<number, (response: JSONRPCMessage) => void>();
  private authToken?: string;

  constructor(options: { authToken?: string } = {}) {
    this.authToken = options.authToken;
  }

  async connect(serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      this.eventSource = new EventSource(serverUrl, { headers });

      this.eventSource.onerror = (error) => {
        reject(new Error('Failed to connect to server'));
      };

      this.eventSource.addEventListener('endpoint', (event) => {
        const data = JSON.parse(event.data);
        this.messageEndpoint = `${new URL(serverUrl).origin}${data.endpoint}?sessionId=${data.sessionId}`;
        resolve();
      });

      this.eventSource.addEventListener('message', (event) => {
        const message = JSON.parse(event.data) as JSONRPCMessage;
        const handler = this.messageHandlers.get(message.id as number);
        if (handler) {
          handler(message);
          this.messageHandlers.delete(message.id as number);
        }
      });
    });
  }
}
```

## Connection Flow

1. **Initial Connection**
   - Client connects to SSE endpoint
   - Server sends endpoint information
   - Client stores session ID and message endpoint

2. **Initialization**
   - Client sends initialize request
   - Server responds with capabilities
   - Connection is ready for use

3. **Message Exchange**
   - Client sends messages via HTTP POST
   - Server responds via SSE
   - Each message has a unique ID
   - Responses are matched to requests

4. **Disconnection**
   - Client can disconnect at any time
   - Server cleans up resources
   - Connection can be re-established

## Security Considerations

1. **Authentication**
   - Optional token-based auth
   - Bearer token in Authorization header
   - Server validates token before accepting connection

2. **Session Management**
   - Unique session ID per connection
   - Messages tied to session
   - Automatic cleanup on disconnect

3. **Error Handling**
   - Standard JSON-RPC error format
   - HTTP status codes for transport errors
   - Detailed error messages

## Best Practices

1. **Connection Management**
   - Implement reconnection logic
   - Handle network errors gracefully
   - Clean up resources on disconnect

2. **Message Handling**
   - Validate message format
   - Handle timeouts
   - Implement retry logic

3. **Resource Management**
   - Track active connections
   - Clean up unused resources
   - Monitor connection health

4. **Error Handling**
   - Log errors for debugging
   - Provide meaningful error messages
   - Handle edge cases

## Example Usage

```typescript
// Server setup
const server = new MCPServer({ authToken: 'secret-token' });
const app = server.createExpressApp();

// Add resources
server.addResource({
  uri: 'example://doc1',
  name: 'Document 1',
  type: 'text',
  content: 'Hello, world!'
});

// Start server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});

// Client usage
async function main() {
  const client = new MCPClient({ authToken: 'secret-token' });
  
  try {
    await client.connect('http://localhost:3000/sse');
    const initResult = await client.initialize();
    const resources = await client.listResources();
    const resource = await client.getResource('example://doc1');
    await client.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}
```

## Extending the Implementation

1. **Additional Features**
   - Add more resource types
   - Implement custom message handlers
   - Add monitoring and logging

2. **Performance Optimization**
   - Implement message batching
   - Add compression
   - Optimize resource handling

3. **Security Enhancements**
   - Add rate limiting
   - Implement message signing
   - Add encryption

4. **Monitoring**
   - Add health checks
   - Implement metrics collection
   - Add logging

## Troubleshooting

1. **Common Issues**
   - Connection failures
   - Message timeouts
   - Resource leaks

2. **Debugging Tips**
   - Check network logs
   - Monitor connection state
   - Verify message format

3. **Performance Issues**
   - Check message size
   - Monitor connection count
   - Review resource usage

## Next Steps

1. **Implementation**
   - Start with basic features
   - Add security
   - Implement monitoring

2. **Testing**
   - Test connection handling
   - Verify message flow
   - Check error cases

3. **Deployment**
   - Set up monitoring
   - Configure security
   - Plan scaling 