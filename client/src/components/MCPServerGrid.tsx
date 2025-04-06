import { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { MCPServer } from '../types';
import { Plus, AlertCircle, CheckCircle2, XCircle, ServerIcon, LayoutGrid, Power, Trash2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';

interface MCPServerGridProps {
  selectedServer: MCPServer | null;
  onSelectServer: (server: MCPServer | null) => void;
}

// Helper function to extract port from URL
const getUrlWithPort = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return `${urlObj.hostname}:${urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80')}`;
  } catch(e) {
    return url; // Return original if invalid URL
  }
};

export function MCPServerGrid({ selectedServer, onSelectServer }: MCPServerGridProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<MCPServer | null>(null);
  const [newServer, setNewServer] = useState({ name: '', url: '' });
  const [filter, setFilter] = useState<'all' | 'virtual'>('all');
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const response = await fetch('/api/mcp-servers');
        let fetchedData = await response.json();
        
        // Ensure each fetched server has necessary fields for the client state
        const processedServers = fetchedData.map((serverData: any) => ({
          name: serverData.name,
          url: serverData.url,
          transport: serverData.transport || 'http', // Default transport if missing
          id: serverData.id || `${serverData.name}-${Date.now()}-${Math.random()}`, // Generate ID if missing
          status: serverData.status || 'offline', // Default status
          lastSeen: serverData.lastSeen || new Date().toISOString(),
          tools: serverData.tools || [], // Ensure array exists
          prompts: serverData.prompts || [], // Ensure array exists
          resources: serverData.resources || [], // Ensure array exists
          isVirtual: serverData.isVirtual || false, // Add property to identify virtual MCPs
          isDisabled: serverData.isDisabled || false, // Track if server is disconnected
        }));

        setServers(processedServers);
      } catch (error) {
        console.error('Failed to fetch servers:', error);
      }
    };

    fetchServers();
  }, []);

  // Validate URL input to check for duplicates
  useEffect(() => {
    if (!newServer.url) {
      setUrlError(null);
      return;
    }

    // Check if URL format is valid
    try {
      new URL(newServer.url);
    } catch (e) {
      setUrlError("Please enter a valid URL (e.g., http://localhost:3000)");
      return;
    }

    // Extract hostname:port for comparison
    const urlWithPort = getUrlWithPort(newServer.url);
    
    // Check if this URL:Port already exists
    const duplicate = servers.find(server => {
      const existingUrlWithPort = getUrlWithPort(server.url);
      return existingUrlWithPort === urlWithPort;
    });

    if (duplicate) {
      setUrlError(`An MCP server with this URL already exists (${duplicate.name})`);
    } else {
      setUrlError(null);
    }
  }, [newServer.url, servers]);

  const handleAddServer = async () => {
    // Don't allow adding if URL error exists
    if (urlError) return;
    
    try {
      const serverDataToAdd = {
        ...newServer,
        transport: 'http',
        isVirtual: false, // Physical servers added directly are not virtual
        isDisabled: false, // New servers start enabled
      };
      const response = await fetch('/api/mcp-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverDataToAdd), 
      });
      const data = await response.json();
      
      const serverId = data.id || `${data.name}-${Date.now()}-${Math.random()}`;
      
      const addedServer: MCPServer = { 
        name: data.name || serverDataToAdd.name,
        url: data.url || serverDataToAdd.url,
        transport: data.transport || serverDataToAdd.transport,
        id: serverId, 
        status: data.status || 'offline',
        lastSeen: data.lastSeen || new Date().toISOString(),
        tools: data.tools || [],
        prompts: data.prompts || [],
        resources: data.resources || [],
        isVirtual: data.isVirtual || false,
        isDisabled: data.isDisabled || false,
      };
      setServers(prevServers => [...prevServers, addedServer]);
      setIsAddDialogOpen(false);
      setNewServer({ name: '', url: '' });
    } catch (error) {
      console.error('Failed to add server:', error);
    }
  };

  const handleToggleServerConnection = async (server: MCPServer) => {
    try {
      // Toggle the disabled state
      const newState = !server.isDisabled;
      
      // Determine endpoint based on server type (vMCP or regular MCP)
      const isVirtualServer = server.isVirtual === true;
      const endpoint = isVirtualServer 
        ? `/api/vmcp-servers/${server.id}/connection`
        : `/api/mcp-servers/${server.id}/connection`;
      
      console.log(`Using connection endpoint: ${endpoint}`);
      
      // Call API to update server state
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDisabled: newState }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to ${newState ? 'disconnect' : 'connect'} server`);
      }
      
      // Update local state
      setServers(prevServers => 
        prevServers.map(s => 
          s.id === server.id 
            ? { ...s, isDisabled: newState, status: newState ? 'offline' : s.status } 
            : s
        )
      );
      
      // If the toggled server was selected, update it
      if (selectedServer?.id === server.id) {
        onSelectServer({ ...selectedServer, isDisabled: newState, status: newState ? 'offline' : selectedServer.status });
      }
    } catch (error) {
      console.error(`Failed to toggle server connection:`, error);
    }
  };
  
  const handleDeleteServer = async () => {
    if (!serverToDelete) return;
    
    try {
      const response = await fetch(`/api/mcp-servers/${serverToDelete.id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete server');
      }
      
      // Remove from local state
      setServers(prevServers => prevServers.filter(s => s.id !== serverToDelete.id));
      
      // If the deleted server was selected, clear selection
      if (selectedServer?.id === serverToDelete.id) {
        onSelectServer(null);
      }
      
      setIsDeleteDialogOpen(false);
      setServerToDelete(null);
    } catch (error) {
      console.error('Failed to delete server:', error);
    }
  };

  const getStatusIcon = (status: MCPServer['status'], isDisabled: boolean) => {
    if (isDisabled) {
      return <Power className="w-4 h-4 text-gray-400" />;
    }
    
    switch (status) {
      case 'online':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'offline':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  // Filter servers based on the selected tab
  const filteredServers = servers.filter(server => 
    filter === 'all' || (filter === 'virtual' && server.isVirtual)
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium">MCP Servers</h2>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add MCP Server</DialogTitle>
                <DialogDescription className="sr-only">Enter the details for the new MCP server.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={newServer.name}
                    onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">URL</Label>
                  <Input
                    id="url"
                    value={newServer.url}
                    onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                    className={urlError ? "border-red-500" : ""}
                  />
                  {urlError && (
                    <p className="text-red-500 text-sm flex items-center mt-1">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      {urlError}
                    </p>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button 
                    onClick={handleAddServer} 
                    disabled={!newServer.name || !newServer.url || !!urlError}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        
        <Tabs value={filter} onValueChange={(value) => setFilter(value as 'all' | 'virtual')}>
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
            <TabsTrigger value="virtual" className="flex-1">Virtual</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <div className="space-y-1">
          {filteredServers.map((server) => (
            <div key={server.id} className="group flex items-center">
              <Button
                variant={selectedServer?.id === server.id ? "secondary" : "ghost"}
                className={`w-full justify-start py-1 px-2 h-auto mr-1 ${
                  selectedServer?.id === server.id ? 'bg-muted' : ''
                } ${server.isDisabled ? 'opacity-60' : ''}`}
                onClick={() => onSelectServer(server)}
              >
                <div className="flex items-center gap-2 w-full overflow-hidden">
                  {server.isVirtual ? 
                    <LayoutGrid className="w-4 h-4 flex-shrink-0" /> : 
                    <ServerIcon className="w-4 h-4 flex-shrink-0" />
                  }
                  <span className="truncate">{server.name}</span>
                  <span className="ml-auto">{getStatusIcon(server.status, server.isDisabled ?? false)}</span>
                </div>
              </Button>
              
              <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-8 w-8" 
                  title={server.isDisabled ? "Connect" : "Disconnect"}
                  onClick={() => handleToggleServerConnection(server)}
                >
                  <Power className={`h-4 w-4 ${server.isDisabled ? 'text-gray-400' : 'text-gray-700'}`} />
                </Button>
                
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-8 w-8 text-red-500" 
                  title="Delete Server"
                  onClick={() => {
                    setServerToDelete(server);
                    setIsDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the server "{serverToDelete?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteServer}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 