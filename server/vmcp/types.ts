export type VMCPServerStatus = 'stopped' | 'starting' | 'running' | 'error' | 'partially_degraded';

export interface UnderlyingServerStatus {
    serverId: string;
    status: 'connecting' | 'connected' | 'error' | 'disconnected';
    lastError?: string;
}

// Expand aggregation rules
export type VMCPAggregationRule =
    | { type: 'aggregate_all' } 
    | { type: 'include_tools'; toolNames: string[] } 
    | { type: 'include_resources'; resourceUris: string[] } 
    | { type: 'include_prompts'; promptNames: string[] };
    // Can add exclude rules or more complex combinations later

export interface VMCPDefinition {
    id: string; // Unique ID assigned by the manager
    name: string; // User-friendly name
    port: number; // Port the vMCP instance listens on
    sourceServerIds: string[]; // IDs of MCP servers from the main config
    aggregationRules: VMCPAggregationRule[]; // Rules for selecting/filtering capabilities
    status: VMCPServerStatus; // Runtime status
    underlyingServersStatus: UnderlyingServerStatus[]; // Runtime status of sources
    createdAt: string; // ISO timestamp
    updatedAt: string; // ISO timestamp
}

// Type for creating a new definition (ID, status, etc., are managed)
export type NewVMCPDefinition = Omit<VMCPDefinition, 'id' | 'status' | 'underlyingServersStatus' | 'createdAt' | 'updatedAt'>; 