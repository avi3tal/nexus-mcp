import { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { SimpleMCPServer } from '../types'; // Import from shared types
import { VMPCCreationView, VMCPAggregationRule } from './VMCPCreationView'; // Import the view component AND the rule type

interface VMCPManagerProps {
  availableServers: SimpleMCPServer[]; // Use the client-side type
  onVMCPCreated: () => void; // Callback to refresh the list after creation
}

// This component now primarily acts as a trigger for the creation view
export function VMCPManager({ availableServers, onVMCPCreated }: VMCPManagerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Update signature to match the one expected by VMPCCreationView's onSave prop
  const handleSave = async (name: string, port: number, rules: VMCPAggregationRule[], sourceServerIds: string[]) => {
    console.log("Attempting to save vMCP:", { name, port, rules, sourceServerIds });
    
    // Construct payload using rules and sourceServerIds
    const payload = {
        name,
        port,
        sourceServerIds, // Send the source server IDs
        aggregationRules: rules // Send the constructed rules
    };

    try {
        const response = await fetch('/api/vmcp-servers', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.details || errorData.error || 'Failed to create vMCP');
        }
        
        onVMCPCreated(); 
        setIsOpen(false); 

    } catch (err) {
        console.error('Failed to create vMCP:', err);
        throw err; // Re-throw so VMPCCreationView can display the error
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>Create vMCP</Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl h-[90vh]"> 
         {/* Add Header and Title for Accessibility */}
         <DialogHeader>
           <DialogTitle className="sr-only">Create New Virtual MCP Server</DialogTitle> 
           {/* Using sr-only to hide visually but keep accessible */}
           <DialogDescription className="sr-only">
             Configure and create a new Virtual MCP server by selecting resources from available physical servers.
           </DialogDescription>
         </DialogHeader>
         {/* Render the creation view inside */}
        <VMPCCreationView 
            availableServers={availableServers}
            onSave={handleSave}
            onCancel={() => setIsOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
} 