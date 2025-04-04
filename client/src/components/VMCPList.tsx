import { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ScrollArea } from './ui/scroll-area';
import { JsonView } from './JsonView';
import { VMCP } from '../types';

interface VMCPListProps {
  onSelectVMCP?: (vmcp: VMCP | null) => void;
}

export function VMCPList({ onSelectVMCP }: VMCPListProps) {
  const [vmcps, setVMCPS] = useState<VMCP[]>([]);
  const [selectedVMCP, setSelectedVMCP] = useState<VMCP | null>(null);

  useEffect(() => {
    const fetchVMCPS = async () => {
      try {
        const response = await fetch('/api/vmcps');
        const data = await response.json();
        setVMCPS(data);
      } catch (error) {
        console.error('Failed to fetch vMCPs:', error);
      }
    };

    fetchVMCPS();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/vmcps/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete vMCP');
      }

      setVMCPS((prev) => prev.filter((v) => v.id !== id));
      if (selectedVMCP?.id === id) {
        setSelectedVMCP(null);
        onSelectVMCP?.(null);
      }
    } catch (error) {
      console.error('Failed to delete vMCP:', error);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {vmcps.map((vmcp) => (
            <Card
              key={vmcp.id}
              className={`cursor-pointer ${
                selectedVMCP?.id === vmcp.id ? 'border-primary' : ''
              }`}
              onClick={() => {
                setSelectedVMCP(vmcp);
                onSelectVMCP?.(vmcp);
              }}
            >
              <CardHeader className="p-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{vmcp.name}</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(vmcp.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Tools:</span>
                    <span className="text-sm text-muted-foreground">
                      {vmcp.tools.length}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Prompts:</span>
                    <span className="text-sm text-muted-foreground">
                      {vmcp.prompts.length}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Resources:</span>
                    <span className="text-sm text-muted-foreground">
                      {vmcp.resources.length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      {selectedVMCP && (
        <div className="border-t border-border p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-medium">Tools</h3>
              <JsonView data={selectedVMCP.tools} initialExpandDepth={0} />
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Prompts</h3>
              <JsonView data={selectedVMCP.prompts} initialExpandDepth={0} />
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Resources</h3>
              <JsonView data={selectedVMCP.resources} initialExpandDepth={0} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 