import { useState } from 'react';
import { MCPServerGrid } from './components/MCPServerGrid';
import { ResourceExplorer } from './components/ResourceExplorer';
import { VMCPManager } from './components/VMCPManager';
import { VMCPList } from './components/VMCPList';
import { MCPServer, Resource } from './types';

export function App() {
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [resources] = useState<Resource[]>([]);

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
                <VMCPManager resources={resources} />
              </div>
              <div className="flex-1">
                <VMCPList />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 