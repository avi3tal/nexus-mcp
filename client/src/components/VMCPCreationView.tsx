import { useState, useEffect } from 'react'; // Keep useState, useEffect
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from './ui/scroll-area';
import { Resource, SimpleMCPServer } from '../types';
import { Checkbox } from "./ui/checkbox";

// Define AggregationRule type on client-side (matching server)
export type VMCPAggregationRule =
    | { type: 'aggregate_all' } 
    | { type: 'include_tools'; toolNames: string[] } 
    | { type: 'include_resources'; resourceUris: string[] } 
    | { type: 'include_prompts'; promptNames: string[] };

// Ensure VMCPAggregatedResource includes 'type' from base Resource if needed
interface VMCPAggregatedResource extends Resource {
    serverId: string; // ID of the server this resource comes from
    type: 'tool' | 'prompt' | 'resource'; // Explicitly add type
}

interface VMCPAggregatedCapability {
    tools: VMCPAggregatedResource[];
    prompts: VMCPAggregatedResource[];
    resources: VMCPAggregatedResource[];
}

interface VMPCCreationViewProps {
    availableServers: SimpleMCPServer[];
    onSave: (name: string, port: number, rules: VMCPAggregationRule[], sourceServerIds: string[]) => Promise<void>;
    onCancel: () => void;
}

export function VMPCCreationView({ availableServers, onSave, onCancel }: VMPCCreationViewProps) {
    const [vmcpName, setVmcpName] = useState('');
    const [vmcpPort, setVmcpPort] = useState<number>(3001);
    const [aggregatedCaps, setAggregatedCaps] = useState<VMCPAggregatedCapability>({ tools: [], prompts: [], resources: [] });
    const [selectedResourceUris, setSelectedResourceUris] = useState<Set<string>>(new Set());
    const [selectedToolNames, setSelectedToolNames] = useState<Set<string>>(new Set());
    const [selectedPromptNames, setSelectedPromptNames] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // DEBUG: Log available servers prop
    console.log('[VMPCCreationView] Available Servers Prop:', availableServers);

    useEffect(() => {
        // Only run fetch if availableServers has been populated
        if (!availableServers || availableServers.length === 0) {
            console.log('[VMPCCreationView] Available servers not yet populated, skipping fetch.');
            // Optionally clear existing caps if servers list becomes empty later
            setAggregatedCaps({ tools: [], prompts: [], resources: [] });
            // Also clear selections when servers change
            setSelectedResourceUris(new Set());
            setSelectedToolNames(new Set());
            setSelectedPromptNames(new Set());
            return;
        }

        const fetchAllCapabilities = async () => {
            setIsLoading(true);
            setError(null);
            const allCaps: VMCPAggregatedCapability = { tools: [], prompts: [], resources: [] };
            
            try {
                 // DEBUG: Check if the loop runs
                 console.log(`[VMPCCreationView] Starting fetch loop for ${availableServers.length} servers.`);
                for (const server of availableServers) {
                    console.log(`[VMPCCreationView] Fetching caps for ${server.name} (${server.id})`);
                    const response = await fetch(`/api/mcp-servers/${server.id}/capabilities`);
                     // DEBUG: Log response status
                     console.log(`[VMPCCreationView] Response status for ${server.id}: ${response.status}`);
                    if (!response.ok) {
                        console.warn(`[VMPCCreationView] Failed to fetch capabilities for ${server.name}: ${response.statusText}`);
                        continue; 
                    }
                    const caps = await response.json();
                    // DEBUG: Log raw capabilities received
                    console.log(`[VMPCCreationView] Raw capabilities for ${server.id}:`, caps);
                    
                    const mapToAggregated = (items: any[], type: 'tool' | 'prompt' | 'resource'): VMCPAggregatedResource[] => {
                        return (items || []).map((item: any) => {
                            const fallbackUri = `${type}://${server.id}/${item.name || item.uri || Date.now()}`;
                            return {
                                uri: item.uri || fallbackUri,
                                name: item.name || item.uri || 'Unnamed Capability',
                                serverId: server.id,
                                type: type,
                            };
                        }).filter(item => !!item.uri);
                    };

                    allCaps.tools.push(...mapToAggregated(caps.tools, 'tool'));
                    allCaps.prompts.push(...mapToAggregated(caps.prompts, 'prompt'));
                    allCaps.resources.push(...mapToAggregated(caps.resources, 'resource'));
                }
                 // DEBUG: Log final aggregated object before setting state
                 console.log('[VMPCCreationView] Final Aggregated Caps before setState:', allCaps);
                setAggregatedCaps(allCaps);
            } catch (err) {                
                console.error('[VMPCCreationView] Error fetching capabilities:', err);
                setError(err instanceof Error ? err.message : 'An unknown error occurred');
            } finally {
                setIsLoading(false);
            }
        };

        fetchAllCapabilities();
       
    }, [availableServers]);

    const handleCheckboxChange = (
        identifier: string,
        type: 'tool' | 'prompt' | 'resource',
        checked: boolean | string
    ) => {
        const isChecked = typeof checked === 'boolean' ? checked : checked === 'true';
        const updater = (prev: Set<string>): Set<string> => {
            const newSet = new Set(prev);
            if (isChecked) {
                newSet.add(identifier);
            } else {
                newSet.delete(identifier);
            }
            return newSet;
        };

        if (type === 'resource') {
            setSelectedResourceUris(updater);
        } else if (type === 'tool') {
            setSelectedToolNames(updater);
        } else if (type === 'prompt') {
            setSelectedPromptNames(updater);
        }
    };

    const handleSaveClick = async () => {
        if (!vmcpName || !vmcpPort) { 
             setError("Name and Port are required.");
             return;
        }
        
        if (!availableServers || availableServers.length === 0) {
            setError("Cannot create vMCP without available source servers.");
            return;
        }

        const rules: VMCPAggregationRule[] = [];
        let somethingSelected = false;

        if (selectedToolNames.size > 0) {
            rules.push({ type: 'include_tools', toolNames: Array.from(selectedToolNames) });
            somethingSelected = true;
        }
        if (selectedPromptNames.size > 0) {
            rules.push({ type: 'include_prompts', promptNames: Array.from(selectedPromptNames) });
             somethingSelected = true;
        }
        if (selectedResourceUris.size > 0) {
            rules.push({ type: 'include_resources', resourceUris: Array.from(selectedResourceUris) });
             somethingSelected = true;
        }

        if (!somethingSelected) {
             setError("Please select at least one capability (tool, prompt, or resource).");
             return;
        }
        
        const sourceServerIds = availableServers.map(s => s.id);
        if (sourceServerIds.length === 0) {
             setError("Cannot create vMCP: No source servers identified.");
             return;
        }

        setError(null);
        try {
            await onSave(vmcpName, vmcpPort, rules, sourceServerIds); 
        } catch (saveError) {
             setError(saveError instanceof Error ? saveError.message : "Failed to save vMCP");
        }
    };

    const renderCapabilityList = (
        items: VMCPAggregatedResource[], 
        type: 'tool' | 'prompt' | 'resource',
        selectedSet: Set<string>
    ) => {
        if (isLoading) return <p>Loading...</p>;
        if (items.length === 0) return <p className="text-muted-foreground">No {type}s found.</p>;

        return (
            <ScrollArea className="h-[400px] border rounded-md p-2">
                 <div className="space-y-2">
                    {items.map(item => {
                        const identifier = type === 'resource' ? item.uri : item.name;
                        if (!identifier) {
                           console.warn('Skipping rendering item without identifier:', item);
                           return null; 
                        } 
                        return (
                            <div key={identifier} className="flex items-center justify-between p-2 hover:bg-accent rounded">
                                <div className="flex items-center space-x-2">
                                  <Checkbox 
                                     id={identifier}
                                     checked={selectedSet.has(identifier)}
                                     onCheckedChange={(checked) => handleCheckboxChange(identifier, type, checked)}
                                  />
                                  <label 
                                    htmlFor={identifier} 
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 truncate cursor-pointer"
                                  >
                                    {item.name} 
                                  </label>
                                </div>
                                <span className="text-xs text-muted-foreground">from: {item.serverId}</span>
                            </div>
                        );
                    })}
                 </div>
            </ScrollArea>
        );
    };

    // DEBUG: Log state right before render
    console.log('[VMPCCreationView] Rendering with aggregatedCaps:', aggregatedCaps);

    return (
        <div className="p-4 flex flex-col h-full space-y-4">
            <h2 className="text-2xl font-semibold">Create New Virtual MCP</h2>
            
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <Label htmlFor="vmcp-c-name">Name</Label>
                    <Input 
                        id="vmcp-c-name" 
                        value={vmcpName} 
                        onChange={e => setVmcpName(e.target.value)} 
                        placeholder="e.g., Aggregated Dev Tools"
                    />
                </div>
                 <div className="space-y-1">
                    <Label htmlFor="vmcp-c-port">Port</Label>
                    <Input 
                        id="vmcp-c-port" 
                        type="number" 
                        value={vmcpPort} 
                        onChange={e => setVmcpPort(parseInt(e.target.value) || 0)} 
                        placeholder="e.g., 3001"
                    />
                </div>
            </div>

            <Tabs defaultValue="tools" className="flex-grow flex flex-col">
                <TabsList className="mb-2">
                    <TabsTrigger value="tools">Tools ({aggregatedCaps.tools.length})</TabsTrigger>
                    <TabsTrigger value="prompts">Prompts ({aggregatedCaps.prompts.length})</TabsTrigger>
                    <TabsTrigger value="resources">Resources ({aggregatedCaps.resources.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="tools" className="flex-grow overflow-hidden">
                     {renderCapabilityList(aggregatedCaps.tools, 'tool', selectedToolNames)}
                 </TabsContent>
                 <TabsContent value="prompts" className="flex-grow overflow-hidden">
                     {renderCapabilityList(aggregatedCaps.prompts, 'prompt', selectedPromptNames)}
                 </TabsContent>
                 <TabsContent value="resources" className="flex-grow overflow-hidden">
                     {renderCapabilityList(aggregatedCaps.resources, 'resource', selectedResourceUris)}
                 </TabsContent>
            </Tabs>
            
            {error && <p className="text-sm text-red-600">Error: {error}</p>}

            <div className="flex justify-end space-x-2 pt-4 border-t">
                <Button variant="outline" onClick={onCancel}>Cancel</Button>
                <Button onClick={handleSaveClick} disabled={isLoading}>Save vMCP</Button>
            </div>
        </div>
    );
} 