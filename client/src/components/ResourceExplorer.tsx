import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { ScrollArea } from './ui/scroll-area';
import { Wrench, FileText, Copy, PlayIcon } from 'lucide-react';
import { MCPServer, Resource } from '../types';
import { ResourceDetails } from './ResourceDetails';
import { ToolExecutor } from './ToolExecutor';
import { Tool, Resource as MCPResource } from '@modelcontextprotocol/sdk';

interface ResourceExplorerProps {
  selectedServer: MCPServer | null;
  selectedResource: Resource | null;
  onSelectResource: (resource: Resource | null) => void;
}

// Helper to convert MCP capabilities to the local Resource format
const mapCapabilitiesToResources = (server: MCPServer): Resource[] => {
  // Ensure server.tools, prompts, resources are arrays
  const safeTools = Array.isArray(server.tools) ? server.tools : [];
  const safePrompts = Array.isArray(server.prompts) ? server.prompts : [];
  const safeResources = Array.isArray(server.resources) ? server.resources : [];

  const tools = safeTools.map(tool => ({
    uri: `mcp-tool://${server.id}/${tool.name}`,
    name: tool.name,
    type: 'tool',
    content: JSON.stringify(tool)
  }));
  const prompts = safePrompts.map(prompt => ({
    uri: `mcp-prompt://${server.id}/${prompt.name}`,
    name: prompt.name,
    type: 'prompt',
    content: JSON.stringify(prompt)
  }));
  // Use MCPResource type for safety
  const resources = safeResources.map((res: MCPResource) => ({
    uri: res.uri,
    // Use optional chaining for name, falling back to URI
    name: (res as any).name || res.uri, // Cast to any if name isn't in MCPResource type
    type: 'resource',
    content: JSON.stringify(res)
  }));

  return [
      ...tools as Resource[], 
      ...prompts as Resource[], 
      ...resources as Resource[]
  ];
};

export function ResourceExplorer({ selectedServer, selectedResource, onSelectResource }: ResourceExplorerProps) {
  const [allResources, setAllResources] = useState<Resource[]>([]); // All resources for the selected server
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'tools' | 'prompts' | 'resources' | 'server-info' | 'tool-executor'>('tools');
  const [dependentVMCPs, setDependentVMCPs] = useState<{ id: string; name: string; uses: string[] }[]>([]);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  useEffect(() => {
    const fetchServerCapabilities = async (serverId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        console.log(`Fetching capabilities for server: ${serverId}`);
        
        // Determine endpoint based on server type (vMCP or regular MCP)
        const isVirtualServer = selectedServer?.isVirtual === true;
        const endpoint = isVirtualServer 
          ? `/api/vmcp-servers/${serverId}/capabilities`
          : `/api/mcp-servers/${serverId}/capabilities`;
          
        console.log(`Using endpoint: ${endpoint}`);
        const response = await fetch(endpoint);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch capabilities: ${response.statusText}`);
        }
        
        const capabilities = await response.json();
        console.log(`Received capabilities for ${serverId}:`, capabilities);

        // Map the fetched capabilities (assuming format { tools: [], prompts: [], resources?: [] })
        const serverDataWithCapabilities: MCPServer = {
           ...(selectedServer as MCPServer), // Cast because we check selectedServer exists
           tools: capabilities.tools || [],
           prompts: capabilities.prompts || [],
           resources: capabilities.resources || [], // Handle optional resources
        };

        const serverResources = mapCapabilitiesToResources(serverDataWithCapabilities);
        setAllResources(serverResources);
      } catch (err) {
        console.error('Failed to fetch server capabilities:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
        setAllResources([]); // Clear resources on error
      } finally {
        setIsLoading(false);
      }
    };

    // Function to fetch vMCPs that depend on this server
    const fetchDependentVMCPs = async (serverId: string) => {
      try {
        // Determine endpoint based on server type (vMCP or regular MCP)
        const isVirtualServer = selectedServer?.isVirtual === true;
        const endpoint = isVirtualServer 
          ? `/api/vmcp-servers/${serverId}/dependents`
          : `/api/mcp-servers/${serverId}/dependents`;
          
        console.log(`Using dependents endpoint: ${endpoint}`);
        const response = await fetch(endpoint);
        
        if (!response.ok) {
          console.warn(`Could not fetch dependent vMCPs: ${response.statusText}`);
          return;
        }
        
        const data = await response.json();
        setDependentVMCPs(data);
      } catch (err) {
        console.warn('Failed to fetch dependent vMCPs:', err);
        setDependentVMCPs([]);
      }
    };

    if (selectedServer) {
      fetchServerCapabilities(selectedServer.id);
      fetchDependentVMCPs(selectedServer.id);
      // Reset selected resource when server changes
      onSelectResource(null);
    } else {
      // Clear resources if no server is selected
      setAllResources([]);
      setDependentVMCPs([]);
      setError(null);
      onSelectResource(null);
    }
  // React to changes in selectedServer
  }, [selectedServer, onSelectResource]);

  // Filter resources based on the active tab
  const displayedResources = allResources.filter(resource => {
    if (activeTab === 'server-info') return false;
    return resource.type === activeTab.slice(0, -1);
  });
  
  // Count resources by type
  const toolCount = allResources.filter(r => r.type === 'tool').length;
  const promptCount = allResources.filter(r => r.type === 'prompt').length;
  const resourceCount = allResources.filter(r => r.type === 'resource').length;

  const getTabIcon = (tabType: string) => {
    switch (tabType) {
      case 'tools': return <Wrench className="w-4 h-4 mr-2" />;
      case 'prompts': return <Copy className="w-4 h-4 mr-2" />;
      case 'resources': return <FileText className="w-4 h-4 mr-2" />;
      default: return null;
    }
  };

  // Handler for selecting a tool for execution
  const handleToolSelect = (resource: Resource | null) => {
    if (resource && resource.type === 'tool' && resource.content) {
      try {
        // Parse the JSON string content back into an object
        const toolObject = JSON.parse(resource.content);
        setSelectedTool(toolObject as Tool);
        setActiveTab('tool-executor');
      } catch (parseError) {
        console.error("Failed to parse tool content:", parseError);
        setSelectedTool(null);
        onSelectResource(null); // Clear selection on error
      }
    } else {
      setSelectedTool(null);
      onSelectResource(resource);
    }
  };

  if (!selectedServer) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select a server to view resources</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Server header with metadata toggle */}
      <div className="p-4 border-b border-border flex justify-between items-center">
        <h2 className="text-xl font-semibold">{selectedServer.name}</h2>
        <Tabs value={activeTab} 
              onValueChange={(v) => setActiveTab(v as 'tools' | 'prompts' | 'resources' | 'server-info' | 'tool-executor')}>
          <TabsList>
            <TabsTrigger value="tools" className="flex items-center">
              {getTabIcon('tools')}Tools ({toolCount})
            </TabsTrigger>
            <TabsTrigger value="prompts" className="flex items-center">
              {getTabIcon('prompts')}Prompts ({promptCount})
            </TabsTrigger>
            <TabsTrigger value="resources" className="flex items-center">
              {getTabIcon('resources')}Resources ({resourceCount})
            </TabsTrigger>
            <TabsTrigger value="server-info">Info</TabsTrigger>
            {selectedTool && (
              <TabsTrigger value="tool-executor" className="flex items-center">
                <PlayIcon className="w-4 h-4 mr-2" />
                Run: {selectedTool.name}
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      </div>

      {/* Loading/Error states */} 
      {isLoading && <div className="p-4 text-center">Loading capabilities...</div>}
      {error && <div className="p-4 text-center text-red-500">Error: {error}</div>}
      
      {/* Resource content */}
      {!isLoading && !error && activeTab !== 'server-info' && activeTab !== 'tool-executor' && (
        <div className="grid grid-cols-2 h-[calc(100%-73px)]">
          <div className="overflow-y-auto border-r border-border p-4">
            <h3 className="text-lg font-medium mb-4">
              {activeTab === 'tools' ? 'Available Tools' : 
               activeTab === 'prompts' ? 'Available Prompts' : 'Available Resources'}
            </h3>
            
            {displayedResources.length === 0 ? (
              <p className="text-muted-foreground">No {activeTab} found</p>
            ) : (
              <ScrollArea className="h-[calc(100vh-240px)]">
                <div className="space-y-2 pr-4">
                  {displayedResources.map((resource) => (
                    <Card 
                      key={resource.uri}
                      className={`cursor-pointer hover:bg-accent/50 transition-colors ${ 
                        selectedResource?.uri === resource.uri ? 'border-primary' : ''
                      }`}
                      onClick={() => 
                        activeTab === 'tools' 
                          ? handleToolSelect(resource) 
                          : onSelectResource(resource)
                      }
                    >
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex items-center">
                          {getTabIcon(activeTab)}
                          <span>{resource.name}</span>
                        </div>
                        {activeTab === 'tools' && (
                          <PlayIcon className="w-4 h-4 opacity-50 hover:opacity-100" />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          <div className="overflow-hidden">
            <ResourceDetails resource={selectedResource} />
          </div>
        </div>
      )}
      
      {/* Server info if in server info mode */}
      {activeTab === 'server-info' && (
        <div className="overflow-auto p-4">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Server Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <span className="font-medium">URL:</span> {selectedServer.url}
                </div>
                <div>
                  <span className="font-medium">Status:</span> {' '}
                  <span className={selectedServer.status === 'online' ? 'text-green-600' : 
                                   selectedServer.status === 'error' ? 'text-red-600' : 'text-gray-600'}>
                    {selectedServer.isDisabled ? 'Disconnected' : selectedServer.status}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Last Seen:</span> {selectedServer.lastSeen ? new Date(selectedServer.lastSeen).toLocaleString() : 'N/A'}
                </div>
                <div>
                  <span className="font-medium">Transport:</span> {selectedServer.transport}
                </div>
                <div>
                  <span className="font-medium">Type:</span> {selectedServer.isVirtual ? 'Virtual MCP' : 'Physical MCP'}
                </div>
                <div>
                  <span className="font-medium">Resources:</span> {' '}
                  {toolCount} tools, {promptCount} prompts, {resourceCount} resources
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Dependent vMCPs section */}
          <Card>
            <CardHeader>
              <CardTitle>Dependent Virtual MCPs</CardTitle>
            </CardHeader>
            <CardContent>
              {dependentVMCPs.length === 0 ? (
                <p className="text-muted-foreground">No vMCPs are using resources from this server.</p>
              ) : (
                <div className="space-y-4">
                  {dependentVMCPs.map(vmcp => (
                    <div key={vmcp.id} className="border p-3 rounded-md">
                      <h3 className="font-medium text-lg">{vmcp.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Uses: {vmcp.uses.join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      
      {activeTab === 'tool-executor' && (
        <div className="h-[calc(100%-73px)]">
          <ToolExecutor tool={selectedTool} serverId={selectedServer.id} />
        </div>
      )}
    </div>
  );
} 