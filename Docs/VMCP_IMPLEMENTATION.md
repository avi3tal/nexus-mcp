# vMCP Implementation Guide

This guide explains how to implement the vMCP (Virtual Model Context Protocol) layer on top of MCP SSE transport.

## Overview

vMCP provides a virtualized layer that:
- Manages multiple MCP connections
- Routes messages between clients and servers
- Handles connection lifecycle
- Provides unified interface for clients

## Core Components

### 1. Common Types

```typescript
interface VMCPConnection {
  id: string;
  serverUrl: string;
  client: MCPClient;
  status: 'connecting' | 'connected' | 'disconnected';
  capabilities: MCPCapabilities;
}

interface VMCPMessage {
  connectionId: string;
  message: JSONRPCMessage;
}

interface VMCPNotification {
  connectionId: string;
  notification: JSONRPCMessage;
}
```

### 2. vMCP Server Implementation

```typescript
class VMCPServer {
  private connections = new Map<string, VMCPConnection>();
  private messageHandlers = new Map<string, (message: VMCPMessage) => Promise<void>>();
  private notificationHandlers = new Set<(notification: VMCPNotification) => void>();

  async addConnection(serverUrl: string, options: { authToken?: string } = {}): Promise<string> {
    const connectionId = randomUUID();
    const client = new MCPClient(options);

    const connection: VMCPConnection = {
      id: connectionId,
      serverUrl,
      client,
      status: 'connecting',
      capabilities: {}
    };

    this.connections.set(connectionId, connection);

    try {
      await client.connect(serverUrl);
      const initResult = await client.initialize();
      connection.status = 'connected';
      connection.capabilities = initResult.capabilities;
      return connectionId;
    } catch (error) {
      this.connections.delete(connectionId);
      throw error;
    }
  }

  async sendMessage(connectionId: string, message: JSONRPCMessage): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const handler = this.messageHandlers.get(message.method || '');
    if (handler) {
      await handler({ connectionId, message });
    }
  }

  onNotification(handler: (notification: VMCPNotification) => void): void {
    this.notificationHandlers.add(handler);
  }
}
```

### 3. vMCP Client Implementation

```typescript
class VMCPClient {
  private server: VMCPServer;
  private connectionId?: string;

  constructor(server: VMCPServer) {
    this.server = server;
  }

  async connect(serverUrl: string, options: { authToken?: string } = {}): Promise<void> {
    this.connectionId = await this.server.addConnection(serverUrl, options);
  }

  async sendMessage(message: JSONRPCMessage): Promise<void> {
    if (!this.connectionId) {
      throw new Error('Not connected');
    }
    await this.server.sendMessage(this.connectionId, message);
  }

  onNotification(handler: (notification: JSONRPCMessage) => void): void {
    this.server.onNotification(({ connectionId, notification }) => {
      if (connectionId === this.connectionId) {
        handler(notification);
      }
    });
  }
}
```

## Connection Flow

1. **Server Setup**
   - Create vMCP server instance
   - Register message handlers
   - Set up notification handlers

2. **Client Connection**
   - Create vMCP client
   - Connect to vMCP server
   - Get connection ID

3. **Message Routing**
   - Client sends message to vMCP server
   - Server routes to appropriate MCP connection
   - Response sent back to client

4. **Notification Handling**
   - MCP server sends notification
   - vMCP server routes to clients
   - Clients receive notifications

## Security Considerations

1. **Connection Security**
   - Each MCP connection has own auth
   - vMCP layer adds additional security
   - Connection isolation

2. **Message Security**
   - Validate message routing
   - Check connection permissions
   - Handle unauthorized access

3. **Error Handling**
   - Connection failures
   - Message routing errors
   - Security violations

## Best Practices

1. **Connection Management**
   - Monitor connection health
   - Handle reconnection
   - Clean up resources

2. **Message Routing**
   - Validate message format
   - Check connection status
   - Handle routing errors

3. **Resource Management**
   - Track active connections
   - Monitor message flow
   - Clean up unused resources

4. **Error Handling**
   - Log errors
   - Provide meaningful messages
   - Handle edge cases

## Example Usage

```typescript
// Server setup
const vmcpServer = new VMCPServer();

// Register message handlers
vmcpServer.messageHandlers.set('initialize', async ({ connectionId, message }) => {
  const connection = vmcpServer.connections.get(connectionId);
  if (!connection) throw new Error('Connection not found');
  
  const response = await connection.client.initialize();
  // Handle response
});

// Start server
const app = express();
app.use(express.json());

app.post('/message', async (req, res) => {
  const { connectionId, message } = req.body;
  try {
    await vmcpServer.sendMessage(connectionId, message);
    res.status(202).send('Accepted');
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('vMCP Server running on port 3000');
});

// Client usage
async function main() {
  const vmcpClient = new VMCPClient(vmcpServer);
  
  try {
    await vmcpClient.connect('http://localhost:3000/sse', {
      authToken: 'secret-token'
    });

    await vmcpClient.sendMessage({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '1.0',
        capabilities: {}
      }
    });

    vmcpClient.onNotification((notification) => {
      console.log('Received notification:', notification);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}
```

## Extending the Implementation

1. **Additional Features**
   - Add connection pooling
   - Implement load balancing
   - Add monitoring

2. **Performance Optimization**
   - Message batching
   - Connection pooling
   - Caching

3. **Security Enhancements**
   - Add rate limiting
   - Implement message signing
   - Add encryption

4. **Monitoring**
   - Connection metrics
   - Message statistics
   - Error tracking

## Troubleshooting

1. **Common Issues**
   - Connection failures
   - Message routing errors
   - Resource leaks

2. **Debugging Tips**
   - Check connection status
   - Monitor message flow
   - Review logs

3. **Performance Issues**
   - Check message routing
   - Monitor connection count
   - Review resource usage

## Next Steps

1. **Implementation**
   - Start with basic features
   - Add security
   - Implement monitoring

2. **Testing**
   - Test connection handling
   - Verify message routing
   - Check error cases

3. **Deployment**
   - Set up monitoring
   - Configure security
   - Plan scaling 