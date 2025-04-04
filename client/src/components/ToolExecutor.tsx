import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tool } from '@modelcontextprotocol/sdk';
import { PlayIcon, RotateCw } from 'lucide-react';
import { JsonView } from './JsonView';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

interface ToolExecutorProps {
  tool: Tool | null;
  serverId: string;
}

// Helper to determine if schema is simple (only primitive properties)
const isSimpleSchema = (schema: any): boolean => {
  if (!schema || !schema.properties || typeof schema.properties !== 'object') {
    return false; // Not a valid/simple properties object
  }
  return Object.values(schema.properties).every((prop: any) => 
    ['string', 'number', 'boolean'].includes(prop?.type)
  );
};

export function ToolExecutor({ tool, serverId }: ToolExecutorProps) {
  // Use state to hold form values dynamically
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [result, setResult] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [execHistory, setExecHistory] = useState<Array<{ input: any; output: any; timestamp: string; success: boolean }>>([]);
  // State for raw JSON input if needed for complex schemas
  const [rawJsonInput, setRawJsonInput] = useState('');

  // Reset form when tool changes
  useEffect(() => {
    if (tool?.inputSchema?.properties) {
      const initialValues: Record<string, any> = {};
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]: [string, any]) => {
        // Set default values based on type
        switch (prop?.type) {
          case 'string': initialValues[key] = ''; break;
          case 'number': initialValues[key] = 0; break;
          case 'boolean': initialValues[key] = false; break;
          default: initialValues[key] = null; // Or handle arrays/objects if needed
        }
      });
      setFormValues(initialValues);
      setRawJsonInput(JSON.stringify(initialValues, null, 2)); // Keep raw JSON updated too
    } else {
      setFormValues({});
      setRawJsonInput('{}');
    }
    setResult(null); // Clear previous results
    setError(null); // Clear previous errors
    // Optionally clear history too, or keep it per tool session?
    // setExecHistory([]);
  }, [tool]);

  if (!tool) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-muted-foreground">Select a tool to execute</p>
      </div>
    );
  }

  const handleInputChange = (key: string, value: any, type: string) => {
    let processedValue = value;
    if (type === 'number') {
      processedValue = value === '' ? null : Number(value);
      if (isNaN(processedValue)) {
        processedValue = null; // Handle invalid number input gracefully?
      }
    } else if (type === 'boolean') {
      processedValue = Boolean(value);
    }
    setFormValues(prev => ({ ...prev, [key]: processedValue }));
  };

  const handleExecute = async () => {
    setIsExecuting(true);
    setError(null);
    let params: Record<string, any>;
    let inputForHistory: any;

    const schemaIsSimple = isSimpleSchema(tool.inputSchema);

    try {
      if (schemaIsSimple) {
        // Construct params from form state
        params = { ...formValues };
        inputForHistory = params;
        // Basic validation (e.g., check required fields if specified in schema)
        if (tool.inputSchema?.required) {
          for (const reqField of tool.inputSchema.required) {
            if (params[reqField] === null || params[reqField] === undefined || params[reqField] === '') {
              throw new Error(`Missing required field: ${reqField}`);
            }
          }
        }
      } else {
        // Use raw JSON input for complex schemas
        try {
          params = rawJsonInput.trim() ? JSON.parse(rawJsonInput) : {};
          inputForHistory = rawJsonInput;
        } catch (e) {
          throw new Error('Invalid JSON input for complex schema. Please check your syntax.');
        }
      }
      
      // Call the API
      const response = await fetch(`/api/mcp-servers/${serverId}/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: tool.name, params }),
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to execute tool');
      }
      
      const data = await response.json();
      setResult(data.result);
      setExecHistory(prev => [{ input: inputForHistory, output: data.result, timestamp: new Date().toISOString(), success: true }, ...prev.slice(0, 9)]);
      
    } catch (err) {
      console.error('Tool execution failed:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setExecHistory(prev => [{ input: inputForHistory ?? formValues, output: { error: err instanceof Error ? err.message : 'Unknown error' }, timestamp: new Date().toISOString(), success: false }, ...prev.slice(0, 9)]);
    } finally {
      setIsExecuting(false);
    }
  };

  const renderInputFields = () => {
    if (!tool.inputSchema?.properties) {
      return <p className="text-sm text-muted-foreground">Tool takes no parameters.</p>;
    }

    const schemaIsSimple = isSimpleSchema(tool.inputSchema);

    if (schemaIsSimple) {
      return Object.entries(tool.inputSchema.properties).map(([key, prop]: [string, any]) => {
        const fieldId = `tool-param-${key}`;
        const isRequired = tool.inputSchema?.required?.includes(key);
        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={fieldId}>
              {key}{isRequired ? ' *' : ''}
              {prop.description && <span className="text-xs text-muted-foreground ml-2">({prop.description})</span>}
            </Label>
            {prop.type === 'string' && (
              <Input 
                id={fieldId} 
                type="text" 
                value={formValues[key] ?? ''}
                onChange={(e) => handleInputChange(key, e.target.value, prop.type)}
                className="font-mono text-sm"
              />
            )}
            {prop.type === 'number' && (
              <Input 
                id={fieldId} 
                type="number" 
                value={formValues[key] ?? ''} 
                onChange={(e) => handleInputChange(key, e.target.value, prop.type)}
                className="font-mono text-sm"
              />
            )}
            {prop.type === 'boolean' && (
              // Basic checkbox for boolean
              <input 
                id={fieldId} 
                type="checkbox" 
                checked={formValues[key] ?? false}
                onChange={(e) => handleInputChange(key, e.target.checked, prop.type)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
            )}
            {/* Add handlers for other simple types like enums (select) if needed */} 
          </div>
        );
      });
    } else {
      // Fallback to Textarea for complex/non-simple types
      return (
        <div className="space-y-1">
           <Label htmlFor="raw-json-input">Input Parameters (JSON)</Label>
           <Textarea
             id="raw-json-input"
             placeholder='Enter parameters as JSON object'
             value={rawJsonInput}
             onChange={(e) => setRawJsonInput(e.target.value)}
             className="font-mono text-sm"
             rows={8}
           />
           <p className="text-xs text-muted-foreground">Complex schema detected, please provide input as JSON.</p>
        </div>
      );
    }
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Execute: {tool.name}</CardTitle>
          {tool.description && <p className="text-sm text-muted-foreground">{tool.description}</p>}
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Render dynamic inputs or fallback */} 
            <div className="space-y-3">
              {renderInputFields()}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleExecute} disabled={isExecuting} className="gap-2">
                {isExecuting ? <RotateCw className="h-4 w-4 animate-spin" /> : <PlayIcon className="h-4 w-4" />}
                Run Tool
              </Button>
            </div>
            
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
                {error}
              </div>
            )}
            
            {result !== null && (
              <div>
                <h3 className="text-sm font-medium mb-2">Result</h3>
                <div className="border rounded-md p-3 bg-muted/50">
                  <JsonView data={result} initialExpandDepth={2} />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      
      {/* Execution History Card (no changes needed here) */}
      {execHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Execution History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {execHistory.map((item, i) => (
                <div 
                  key={i} 
                  className={`p-2 rounded-md text-sm border ${
                    item.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="flex justify-between mb-1">
                    <span className="font-medium">{new Date(item.timestamp).toLocaleTimeString()}</span>
                    <span className={item.success ? 'text-green-600' : 'text-red-600'}>
                      {item.success ? 'Success' : 'Error'}
                    </span>
                  </div>
                  <div className="truncate font-mono text-xs">
                    Input: {typeof item.input === 'string' ? item.input : JSON.stringify(item.input) || '{}'}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
} 