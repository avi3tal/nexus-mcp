import { Transport } from './Transport.js';

export class TransportManager {
  private transports: Map<string, Transport> = new Map();
  private options: { [key: string]: unknown } = {};
  private connectedIds: Set<string> = new Set();

  getTransport(serverId: string): Transport | null {
    return this.transports.get(serverId) ?? null;
  }

  addTransport(serverId: string, transport: Transport): void {
    this.transports.set(serverId, transport);
  }

  removeTransport(serverId: string): void {
    this.transports.delete(serverId);
    this.connectedIds.delete(serverId);
  }

  async connect(serverId: string): Promise<void> {
    const transport = this.getTransport(serverId);
    if (!transport) throw new Error(`Transport not found for server ${serverId}`);
    await transport.start();
    this.connectedIds.add(serverId);
  }

  async disconnect(serverId: string): Promise<void> {
    const transport = this.getTransport(serverId);
    if (!transport) throw new Error(`Transport not found for server ${serverId}`);
    await transport.close();
    this.connectedIds.delete(serverId);
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.transports.values()).map(transport => transport.close())
    );
    this.connectedIds.clear();
  }

  isConnected(serverId: string): boolean {
    return this.connectedIds.has(serverId);
  }

  getConnectedIds(): string[] {
    return Array.from(this.connectedIds);
  }
} 