import { useState, useEffect, useCallback } from 'react';
import { MCPServerGrid } from './components/MCPServerGrid';
import { ResourceExplorer } from './components/ResourceExplorer';
import { VMCPManager } from './components/VMCPManager';
import { VMCPList } from './components/VMCPList';
import { MCPServer, Resource, SimpleMCPServer } from './types';

export function App() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [vmcpUpdateCounter, setVmcpUpdateCounter] = useState(0);

  useEffect(() => {
    async function fetchServers() {
      try {
        const response = await fetch('/api/mcp-servers');
        if (!response.ok) throw new Error('Failed to fetch servers');
        const data = await response.json();
        setServers(data);
      } catch (error) {
        console.error('Error fetching MCP servers:', error);
      }
    }
    fetchServers();
  }, []);

  const handleVMCPCreated = useCallback(() => {
    console.log('vMCP created, triggering list refresh...');
    setVmcpUpdateCounter(prev => prev + 1);
  }, []);

  const availableServersForVMCP: SimpleMCPServer[] = servers
    .filter(s => !s.isVirtual) // Only include physical servers
    .map(s => ({
      id: s.id,
      name: s.name,
      url: s.url
    }));

  return (
    <div className="flex h-screen bg-background">
      <div className="w-64 border-r border-border">
        <MCPServerGrid
          selectedServer={selectedServer}
          onSelectServer={setSelectedServer}
        />
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex">
          <div className="flex-1 border-r border-border">
            <ResourceExplorer
              selectedServer={selectedServer}
              selectedResource={selectedResource}
              onSelectResource={setSelectedResource}
            />
          </div>

          <div className="w-64">
            <div className="h-full flex flex-col">
              <div className="p-4 border-b border-border">
                <VMCPManager 
                  availableServers={availableServersForVMCP} 
                  onVMCPCreated={handleVMCPCreated} 
                />
              </div>
              <div className="flex-1">
                <VMCPList key={vmcpUpdateCounter} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 