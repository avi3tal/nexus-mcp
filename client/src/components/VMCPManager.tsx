import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Resource } from '../types';

interface VMCPManagerProps {
  resources: Resource[];
}

export function VMCPManager({ resources }: VMCPManagerProps) {
  const [name, setName] = useState('');

  const handleCreate = async () => {
    try {
      const response = await fetch('/api/vmcps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          resources,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create vMCP');
      }

      setName('');
    } catch (error) {
      console.error('Failed to create vMCP:', error);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Create vMCP</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create vMCP</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button onClick={handleCreate}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
} 