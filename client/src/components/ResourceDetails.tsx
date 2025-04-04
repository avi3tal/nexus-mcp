import { JsonView } from './JsonView';
import { Resource } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from '../components/ui/badge';
import { Wrench, FileText, Copy } from 'lucide-react';

interface ResourceDetailsProps {
  resource: Resource | null;
}

export function ResourceDetails({ resource }: ResourceDetailsProps) {
  if (!resource) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select a resource to view details</p>
      </div>
    );
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'tool': return <Wrench className="w-4 h-4" />;
      case 'prompt': return <Copy className="w-4 h-4" />;
      case 'resource': return <FileText className="w-4 h-4" />;
      default: return null;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'tool': return 'bg-blue-100 text-blue-800';
      case 'prompt': return 'bg-purple-100 text-purple-800';
      case 'resource': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <Card className="shadow-none border-none">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{resource.name}</CardTitle>
              <Badge className={`flex items-center gap-1 ${getTypeColor(resource.type)}`}>
                {getTypeIcon(resource.type)}
                {resource.type}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-auto flex-1 pt-0">
          <div className="mt-4 border p-4 rounded-md bg-muted/50">
            <JsonView 
              data={resource.content} 
              initialExpandDepth={1} 
              className="overflow-auto max-h-[calc(100vh-250px)]"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 