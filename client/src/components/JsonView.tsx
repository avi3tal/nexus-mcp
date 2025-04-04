import { useState } from 'react';
import { cn } from '../lib/utils';
import { ChevronRight, ChevronDown } from 'lucide-react';

export interface JsonViewProps {
  data: any;
  initialExpandDepth?: number;
  className?: string;
}

export function JsonView({ data, initialExpandDepth = 1, className }: JsonViewProps) {
  return (
    <div className={cn("font-mono text-sm", className)}>
      <JsonNode 
        data={data} 
        name="" 
        isRoot={true} 
        expandDepth={initialExpandDepth} 
      />
    </div>
  );
}

interface JsonNodeProps {
  data: any;
  name: string;
  isRoot?: boolean;
  expandDepth: number;
}

function JsonNode({ data, name, isRoot = false, expandDepth }: JsonNodeProps) {
  const [isExpanded, setIsExpanded] = useState(expandDepth > 0);
  
  const type = Array.isArray(data) ? 'array' : typeof data;
  const isExpandable = ['object', 'array'].includes(type) && data !== null;
  
  const toggleExpand = () => {
    if (isExpandable) {
      setIsExpanded(!isExpanded);
    }
  };
  
  const renderValue = () => {
    if (data === null) return <span className="text-gray-500">null</span>;
    if (data === undefined) return <span className="text-gray-500">undefined</span>;
    
    switch (type) {
      case 'string':
        return <span className="text-green-600">"{data}"</span>;
      case 'number':
        return <span className="text-blue-600">{data}</span>;
      case 'boolean':
        return <span className="text-purple-600">{data.toString()}</span>;
      case 'object':
      case 'array':
        if (isExpanded) {
          const entries = type === 'array' 
            ? data.map((v: any, i: number) => [i, v]) 
            : Object.entries(data);
          
          return (
            <div className="ml-4">
              {entries.map(([key, value]: [string, any], index: number) => (
                <div key={index}>
                  <JsonNode 
                    data={value} 
                    name={key.toString()} 
                    expandDepth={expandDepth - 1} 
                  />
                </div>
              ))}
            </div>
          );
        } else {
          const count = type === 'array' ? data.length : Object.keys(data).length;
          return (
            <span className="text-gray-500">
              {type === 'array' ? `Array(${count})` : `Object (${count} properties)`}
            </span>
          );
        }
      default:
        return <span>{String(data)}</span>;
    }
  };
  
  const renderPrefix = () => {
    if (isRoot) return null;
    
    if (type === 'array' || type === 'object') {
      return (
        <span 
          className="cursor-pointer inline-flex items-center" 
          onClick={toggleExpand}
        >
          {isExpandable && (
            isExpanded 
              ? <ChevronDown className="w-3 h-3 mr-1" /> 
              : <ChevronRight className="w-3 h-3 mr-1" />
          )}
          {name && <span className="text-gray-600 mr-1">{name}:</span>}
          {type === 'array' && <span className="mr-1">[</span>}
          {type === 'object' && <span className="mr-1">{'{'}</span>}
          {!isExpanded && renderValue()}
          {!isExpanded && (type === 'array' ? ']' : '}')}
        </span>
      );
    }
    
    return <span className="text-gray-600 mr-1">{name}: </span>;
  };
  
  const renderSuffix = () => {
    if (isExpanded && isExpandable) {
      return <div>{type === 'array' ? ']' : '}'}</div>;
    }
    return null;
  };
  
  return (
    <div className="whitespace-nowrap">
      {renderPrefix()}
      {(!isExpandable || isExpanded) && renderValue()}
      {renderSuffix()}
    </div>
  );
} 