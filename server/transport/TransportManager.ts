import { SSETransport } from './SSETransport.js';
import { Transport } from './Transport.js';
import { TransportError, TransportErrorCode } from './TransportError.js';

interface TransportManagerOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class TransportManager {
  private transports: Map<string, Transport> = new Map();
  private options: Required<TransportManagerOptions>;

  constructor(options: TransportManagerOptions = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? 5,
      retryDelay: options.retryDelay ?? 1000,
      timeout: options.timeout ?? 30000
    };
  }

  async connect(
    url: string,
    id: string,
    headers: HeadersInit = {}
  ): Promise<Transport> {
    if (this.transports.has(id)) {
      throw new TransportError(
        `Transport with id ${id} already exists`,
        TransportErrorCode.CONNECTION_FAILED,
        { id },
        false
      );
    }

    const headersRecord = Object.fromEntries(new Headers(headers).entries());
    const transport = new SSETransport(url, headersRecord, this.options);
    
    try {
      await transport.start();
      this.transports.set(id, transport);

      transport.onclose = () => {
        this.transports.delete(id);
      };

      transport.onerror = (error) => {
        console.error(`Transport ${id} error:`, error);
        if (error instanceof TransportError && !error.retryable) {
          this.transports.delete(id);
        }
      };

      return transport;
    } catch (error) {
      if (error instanceof Error) {
        throw TransportError.connectionFailed(url, error);
      }
      throw error;
    }
  }

  async disconnect(id: string): Promise<void> {
    const transport = this.transports.get(id);
    if (transport) {
      try {
        await transport.close();
      } catch (error) {
        console.error(`Error disconnecting transport ${id}:`, error);
      } finally {
        this.transports.delete(id);
      }
    }
  }

  getTransport(id: string): Transport | undefined {
    return this.transports.get(id);
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.transports.entries()).map(
      async ([id, transport]) => {
        try {
          await transport.close();
        } catch (error) {
          console.error(`Error disconnecting transport ${id}:`, error);
        }
      }
    );

    await Promise.all(disconnectPromises);
    this.transports.clear();
  }

  isConnected(id: string): boolean {
    return this.transports.has(id);
  }

  getConnectedIds(): string[] {
    return Array.from(this.transports.keys());
  }
} 