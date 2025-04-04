import { Resource } from '../types';
import { cn } from '../lib/utils';

interface ResourceListProps {
  resources: Resource[];
  selectedResource: Resource | null;
  onSelectResource: (resource: Resource | null) => void;
}

export function ResourceList({ resources, selectedResource, onSelectResource }: ResourceListProps) {
  return (
    <div className="h-full overflow-y-auto">
      {resources.map((resource) => (
        <div
          key={resource.id}
          className={cn(
            'p-4 cursor-pointer hover:bg-accent',
            selectedResource?.id === resource.id && 'bg-accent'
          )}
          onClick={() => onSelectResource(resource)}
        >
          <div className="font-medium">{resource.name}</div>
          <div className="text-sm text-muted-foreground">{resource.type}</div>
        </div>
      ))}
    </div>
  );
} 