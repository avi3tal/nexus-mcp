import { useState, useEffect, useCallback } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ScrollArea } from './ui/scroll-area';
// import { JsonView } from './JsonView'; // Remove unused import
import { VMCPInstance } from '../types';
import { Badge } from './ui/badge';

interface VMCPListProps {
  listKey?: number;
  onSelectVMCP?: (vmcp: VMCPInstance | null) => void;
}

export function VMCPList({ listKey, onSelectVMCP }: VMCPListProps) {
  const [vmcps, setVmcps] = useState<VMCPInstance[]>([]);
  const [selectedVMCPId, setSelectedVMCPId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchVMCPS() {
      try {
        const response = await fetch('/api/vmcp-servers');
        if (!response.ok) {
          if (response.status === 404) {
            console.warn('VMCP endpoint not found, maybe server issue?');
            setVmcps([]);
            return;
          }
          throw new Error(`Failed to fetch vMCPs: ${response.statusText}`);
        }
        const data = await response.json();
        setVmcps(data as VMCPInstance[]);
      } catch (err) {
        console.error('Failed to fetch vMCPs:', err);
        setVmcps([]);
      }
    }

    fetchVMCPS();
  }, [listKey]);

  const handleSelect = (vmcp: VMCPInstance) => {
    setSelectedVMCPId(vmcp.id);
    if (onSelectVMCP) {
      onSelectVMCP(vmcp);
    }
  };

  const handleDelete = async (id: string) => {
    console.log('Delete vMCP:', id);
    try {
      const response = await fetch(`/api/vmcp-servers/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to delete vMCP');
      }
      setVmcps((prev) => prev.filter((v) => v.id !== id));
      if (selectedVMCPId === id) {
        setSelectedVMCPId(null);
        if (onSelectVMCP) onSelectVMCP(null);
      }
    } catch (error) {
      console.error('Error deleting vMCP:', error);
    }
  };

  const handleStart = async (id: string) => {
    console.log('Start vMCP:', id);
    try {
      const response = await fetch(`/api/vmcp-servers/${id}/start`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to start vMCP');
      }
      fetchVMCPS();
    } catch (error) {
      console.error('Error starting vMCP:', error);
    }
  };

  const handleStop = async (id: string) => {
    console.log('Stop vMCP:', id);
    try {
      const response = await fetch(`/api/vmcp-servers/${id}/stop`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to stop vMCP');
      }
      fetchVMCPS();
    } catch (error) {
      console.error('Error stopping vMCP:', error);
    }
  };

  const fetchVMCPS = useCallback(async () => {
    try {
      const response = await fetch('/api/vmcp-servers');
      if (!response.ok) {
        if (response.status === 404) {
          setVmcps([]);
          return;
        }
        throw new Error(`Failed to fetch vMCPs: ${response.statusText}`);
      }
      const data = await response.json();
      setVmcps(data as VMCPInstance[]);
    } catch (err) {
      console.error('Failed to fetch vMCPs:', err);
      setVmcps([]);
    }
  }, []);

  useEffect(() => {
    fetchVMCPS();
  }, [listKey, fetchVMCPS]);

  const getStatusColor = (status: VMCPInstance['status']) => {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'starting': return 'bg-yellow-500';
      case 'stopped': return 'bg-gray-500';
      case 'error':
      case 'partially_degraded': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  return (
    <ScrollArea className="h-full p-4">
       <h3 className="text-lg font-medium mb-4">Virtual MCP Instances</h3>
      {vmcps.length === 0 ? (
        <p className="text-muted-foreground">No vMCP instances defined.</p>
      ) : (
        <div className="space-y-3">
          {vmcps.map((vmcp) => (
            <Card key={vmcp.id} 
                  className={`cursor-pointer transition-colors hover:bg-accent ${selectedVMCPId === vmcp.id ? 'border-primary border' : ''}`}
                  onClick={() => handleSelect(vmcp)} >
              <CardHeader className="p-3 flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium truncate">{vmcp.name}</CardTitle>
                 <Badge variant="outline" className={`text-xs ${getStatusColor(vmcp.status)} text-white border-none`}>
                   {vmcp.status}
                 </Badge>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="text-xs text-muted-foreground mb-2">
                   Port: {vmcp.port} | Sources: {vmcp.sourceServerIds.join(', ')}
                </div>
                 <div className="flex space-x-2">
                    {vmcp.status !== 'running' && vmcp.status !== 'starting' && (
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleStart(vmcp.id); }}>Start</Button> 
                    )}
                    {(vmcp.status === 'running' || vmcp.status === 'starting') && (
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleStop(vmcp.id); }}>Stop</Button> 
                    )}
                    <Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); handleDelete(vmcp.id); }}>Delete</Button> 
                  </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </ScrollArea>
  );
} 