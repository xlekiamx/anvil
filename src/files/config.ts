import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ConfigSchema, type Config, getDefaultConfig } from '../types/config.js';
import { ValidationError } from '../utils/errors.js';
import type { Logger } from '../logger/index.js';
import type { GlobalConfigManager } from './global-config.js';
import { getBuiltinConfig } from './builtin-configs.js';

export function getConfigFileName(configName?: string): string {
  return configName ? `config.${configName}.json` : 'config.json';
}

export class ConfigFile {
  public readonly path: string;

  constructor(
    aiDir: string,
    private readonly logger: Logger,
    private readonly configName?: string,
    private readonly globalConfigManager?: GlobalConfigManager
  ) {
    this.path = path.join(aiDir, getConfigFileName(configName));
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.path);
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<Config> {
    // 1. Try local file
    try {
      const content = await fs.readFile(this.path, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return this.validate(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // 2. Try global config (if configName set)
    if (this.configName && this.globalConfigManager) {
      try {
        if (await this.globalConfigManager.exists(this.configName)) {
          this.logger.debug(`Using global config: ${this.configName}`);
          return await this.globalConfigManager.read(this.configName);
        }
      } catch {
        // Fall through
      }
    }

    // 3. Try builtin config (if configName set)
    if (this.configName) {
      const builtin = getBuiltinConfig(this.configName);
      if (builtin) {
        this.logger.debug(`Using builtin config: ${this.configName}`);
        return builtin;
      }
    }

    // 4. Default
    this.logger.debug('Config file not found, using defaults');
    return getDefaultConfig();
  }

  async write(config: Config): Promise<void> {
    const validated = this.validate(config);
    const content = JSON.stringify(validated, null, 2);

    const tempPath = `${this.path}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, this.path);

    this.logger.debug({ path: this.path }, 'Wrote config file');
  }

  async initialize(): Promise<Config> {
    const config = getDefaultConfig();
    await this.write(config);
    this.logger.info('Initialized config file');
    return config;
  }

  private validate(data: unknown): Config {
    const result = ConfigSchema.safeParse(data);
    if (!result.success) {
      const issues = result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      );
      throw new ValidationError('Invalid config file', issues);
    }
    return result.data;
  }
}
