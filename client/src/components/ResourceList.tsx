import { Resource } from '../types';
// import { cn } from '../lib/utils'; // Remove unused import
import { Wrench, Copy, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ResourceListProps {
  resources: Resource[];
  selectedResource: Resource | null;
  onSelectResource: (resource: Resource | null) => void;
}

export function ResourceList({ resources, selectedResource, onSelectResource }: ResourceListProps) {
  const getIcon = (type: string): React.ReactNode => {
    switch (type) {
      case 'tool':
        return <Wrench className="w-4 h-4 text-muted-foreground" />;
      case 'prompt':
        return <Copy className="w-4 h-4 text-muted-foreground" />;
      case 'resource':
        return <FileText className="w-4 h-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-2">
        {resources.map((resource) => (
          <Card
            key={resource.uri}
            className={`cursor-pointer transition-colors hover:bg-accent ${
              selectedResource?.uri === resource.uri ? 'bg-accent border border-primary' : ''
            }`}
            onClick={() => onSelectResource(resource)}
          >
            <CardContent className="p-3 flex items-center">
              {getIcon(resource.type)}
              <span className="ml-2 truncate">{resource.name}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}