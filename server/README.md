# Nexus MCP Server

The server component of the Nexus MCP Platform, providing a centralized orchestration layer for Model Context Protocol (MCP) servers.

## Features

- **MCP Server Management**: Register, discover, and manage MCP servers
- **Virtual MCP (vMCP) Support**: Create lightweight, purpose-specific MCP instances
- **SSE Transport**: Real-time communication using Server-Sent Events
- **Tool Aggregation**: Combine tools from multiple MCP servers
- **API Gateway**: RESTful API for client interactions

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Development Mode

```bash
npm run dev
```

This starts the server in development mode with hot reloading.

### Production Mode

```bash
# Build the project
npm run build

# Start the server
npm start
```

## API Endpoints

### MCP Servers

- `GET /api/mcp-servers` - List all registered MCP servers
- `POST /api/mcp-servers` - Register a new MCP server
- `GET /api/mcp-servers/:id` - Get details of a specific MCP server
- `DELETE /api/mcp-servers/:id` - Unregister an MCP server

### Virtual MCPs

- `GET /api/vmcps` - List all vMCP instances
- `POST /api/vmcps` - Create a new vMCP instance
- `GET /api/vmcps/:id` - Get details of a specific vMCP instance
- `DELETE /api/vmcps/:id` - Delete a vMCP instance

### Tools

- `GET /api/mcp-servers/:id/tools` - List tools available on a specific MCP server
- `POST /api/mcp-servers/:id/tools/execute` - Execute a tool on a specific MCP server
- `GET /api/vmcps/:id/tools` - List tools available on a specific vMCP instance
- `POST /api/vmcps/:id/tools/execute` - Execute a tool on a specific vMCP instance

## Configuration

The server can be configured using environment variables or by modifying the `config/default.json` file.

Key configuration options:

- `PORT`: The port on which the server will listen (default: 3000)
- `LOG_LEVEL`: The logging level (default: info)
- `CORS_ORIGIN`: Allowed CORS origins (default: *)

## Architecture

The server is built with a modular architecture:

- **API Layer**: Express.js routes and controllers
- **Transport Layer**: SSE-based communication with MCP servers
- **VMCP Manager**: Manages virtual MCP instances
- **Capability Registry**: Tracks available tools, prompts, and resources

## Development

### Project Structure

```
server/
├── api/            # API routes and controllers
├── capabilities/   # Capability registry and management
├── config/         # Configuration files
├── models/         # Data models
├── persistence/    # Data persistence layer
├── services/       # Business logic services
├── test/           # Test files
├── transport/      # Transport implementations
├── types/          # TypeScript type definitions
└── vmcp/           # Virtual MCP implementation
```

### Adding New Features

1. Create or modify the appropriate module in the project structure
2. Update the API routes if needed
3. Add tests for new functionality
4. Update documentation

## Troubleshooting

### Common Issues

- **Connection Errors**: Ensure the MCP server is running and accessible
- **Tool Execution Failures**: Check that the tool exists and has the correct parameters
- **vMCP Creation Issues**: Verify that the source servers are registered and running

### Logs

Logs are written to the console by default. Set `LOG_LEVEL` to `debug` for more detailed logs. 