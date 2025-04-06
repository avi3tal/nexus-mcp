# Nexus MCP Client

The client component of the Nexus MCP Platform, providing a web-based interface for managing MCP servers and virtual MCP instances.

## Features

- **MCP Server Management**: Register and manage MCP servers
- **Virtual MCP Creation**: Create and configure vMCP instances
- **Tool Explorer**: Browse and execute tools from MCP servers
- **Resource Explorer**: View and access resources from MCP servers
- **Real-time Updates**: SSE-based communication for live updates

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

This starts the development server with hot reloading.

### Production Build

```bash
# Build the project
npm run build

# Preview the production build
npm run preview
```

## Project Structure

```
client/
├── public/         # Static assets
├── src/
│   ├── components/ # React components
│   │   ├── ui/     # UI components
│   │   └── ...     # Feature-specific components
│   ├── hooks/      # Custom React hooks
│   ├── lib/        # Utility functions
│   ├── types/      # TypeScript type definitions
│   ├── App.tsx     # Main application component
│   └── main.tsx    # Application entry point
├── index.html      # HTML template
└── vite.config.ts  # Vite configuration
```

## Key Components

### MCPServerGrid

Displays a grid of registered MCP servers with their status and capabilities.

### VMCPManager

Manages virtual MCP instances, allowing creation, configuration, and deletion.

### ToolExecutor

Provides an interface for executing tools on MCP servers or vMCP instances.

### ResourceExplorer

Browses and displays resources available from MCP servers.

## Development

### Adding New Features

1. Create or modify components in the appropriate directory
2. Update the routing if needed
3. Add tests for new functionality
4. Update documentation

### Styling

The project uses Tailwind CSS for styling. Custom components are styled using the utility classes provided by Tailwind.

## Troubleshooting

### Common Issues

- **Connection Errors**: Ensure the server is running and accessible
- **Build Failures**: Check for TypeScript errors or missing dependencies
- **UI Rendering Issues**: Verify browser compatibility

### Browser Support

The client is tested and supported on the latest versions of:
- Chrome
- Firefox
- Safari
- Edge 