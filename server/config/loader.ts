import { readFile } from 'fs/promises';
import { NexusConfig } from './types.js';

export class ConfigLoader {
  static async loadFromFile(path: string): Promise<NexusConfig> {
    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as NexusConfig;
    } catch (error) {
      console.warn(`Failed to load config from ${path}:`, error);
      return {
        port: 3000,
        mcpServers: [],
        vmcps: [],
        persistence: { type: 'memory', config: {} }
      };
    }
  }

  static async loadFromEnv(): Promise<Partial<NexusConfig>> {
    const config: Partial<NexusConfig> = {};
    
    if (process.env.NEXUS_PORT) {
      config.port = parseInt(process.env.NEXUS_PORT, 10);
    }
    
    if (process.env.NEXUS_PERSISTENCE_TYPE) {
      config.persistence = {
        type: process.env.NEXUS_PERSISTENCE_TYPE as 'memory' | 'postgres' | 'mongodb',
        config: process.env.NEXUS_PERSISTENCE_CONFIG ? 
          JSON.parse(process.env.NEXUS_PERSISTENCE_CONFIG) : undefined
      };
    }

    return config;
  }
} 