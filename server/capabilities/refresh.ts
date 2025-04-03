import { CapabilityDiscoverer } from './discoverer.js';
import { CapabilityError } from './errors.js';

interface RefreshOptions {
  interval: number;
  onError?: (error: CapabilityError) => void;
}

export class CapabilityRefreshManager {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private options: Required<RefreshOptions>;

  constructor(
    private discoverer: CapabilityDiscoverer,
    options: Partial<RefreshOptions> = {}
  ) {
    this.options = {
      interval: options.interval ?? 300000, // 5 minutes default
      onError: options.onError ?? ((error: CapabilityError) => {
        console.error('Refresh failed:', error);
      })
    };
  }

  getInterval(): number {
    return this.options.interval;
  }

  startRefresh(serverId: string): void {
    if (this.timers.has(serverId)) {
      this.stopRefresh(serverId);
    }

    const refresh = async () => {
      try {
        await this.discoverer.discoverCapabilities(serverId);
      } catch (error) {
        if (error instanceof CapabilityError) {
          this.options.onError(error);
        }
      }
    };

    // Initial refresh
    refresh();

    // Set up periodic refresh
    const timer = setInterval(refresh, this.options.interval);
    this.timers.set(serverId, timer);
  }

  stopRefresh(serverId: string): void {
    const timer = this.timers.get(serverId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(serverId);
    }
  }

  stopAll(): void {
    for (const [serverId] of this.timers) {
      this.stopRefresh(serverId);
    }
  }

  updateInterval(interval: number): void {
    this.options.interval = interval;
    // Restart all timers with new interval
    for (const [serverId] of this.timers) {
      this.stopRefresh(serverId);
      this.startRefresh(serverId);
    }
  }
} 