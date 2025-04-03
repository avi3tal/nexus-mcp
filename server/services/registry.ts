import { ConfigManager } from '../config/manager.js';
import { TransportManager } from '../transport/manager.js';
import { CapabilityRegistry } from '../capabilities/registry.js';
import { CapabilityDiscoverer } from '../capabilities/discoverer.js';
import { CapabilityRefreshManager } from '../capabilities/refresh.js';

export class ServiceRegistry {
  private static instance: ServiceRegistry;
  private services: Map<string, unknown>;
  private configManager: ConfigManager;
  private transportManager: TransportManager;
  private capabilityRegistry: CapabilityRegistry;
  private capabilityDiscoverer: CapabilityDiscoverer;
  private capabilityRefreshManager: CapabilityRefreshManager;

  private constructor() {
    this.services = new Map();
    this.configManager = new ConfigManager();
    this.transportManager = new TransportManager();
    this.capabilityRegistry = new CapabilityRegistry();
    this.capabilityDiscoverer = new CapabilityDiscoverer(
      this.transportManager,
      this.capabilityRegistry
    );
    this.capabilityRefreshManager = new CapabilityRefreshManager(
      this.capabilityDiscoverer
    );
  }

  static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry();
    }
    return ServiceRegistry.instance;
  }

  register<T>(name: string, service: T): void {
    this.services.set(name, service);
  }

  get<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service ${name} not found`);
    }
    return service as T;
  }

  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  getTransportManager(): TransportManager {
    return this.transportManager;
  }

  getCapabilityRegistry(): CapabilityRegistry {
    return this.capabilityRegistry;
  }

  getCapabilityDiscoverer(): CapabilityDiscoverer {
    return this.capabilityDiscoverer;
  }

  getCapabilityRefreshManager(): CapabilityRefreshManager {
    return this.capabilityRefreshManager;
  }
} 