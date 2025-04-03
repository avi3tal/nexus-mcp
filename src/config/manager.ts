import { NexusConfig, NexusConfigSchema } from './types.js';

export class ConfigManager {
  private config: NexusConfig;

  constructor(initialConfig: Partial<NexusConfig> = {}) {
    this.config = this.validateConfig(initialConfig);
  }

  private validateConfig(config: Partial<NexusConfig>): NexusConfig {
    return NexusConfigSchema.parse({
      port: 3000,
      mcpServers: [],
      vmcps: [],
      persistence: { type: 'memory' },
      ...config
    });
  }

  getConfig(): NexusConfig {
    return this.config;
  }

  updateConfig(newConfig: Partial<NexusConfig>): void {
    this.config = this.validateConfig({ ...this.config, ...newConfig });
  }
} 