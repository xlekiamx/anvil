import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigSchema, type Config } from '../types/config.js';
import { ValidationError } from '../utils/errors.js';

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.anvil');

export class GlobalConfigManager {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? DEFAULT_BASE_DIR;
  }

  getConfigsDir(): string {
    return path.join(this.baseDir, 'configs');
  }

  getPromptsDir(): string {
    return path.join(this.baseDir, 'prompts');
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.getConfigsDir(), `${name}.json`));
      return true;
    } catch {
      return false;
    }
  }

  async read(name: string): Promise<Config> {
    const filePath = path.join(this.getConfigsDir(), `${name}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as unknown;
    const result = ConfigSchema.safeParse(data);
    if (!result.success) {
      const issues = result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      );
      throw new ValidationError(`Invalid global config '${name}'`, issues);
    }
    return result.data;
  }

  async write(name: string, config: Config): Promise<void> {
    const dir = this.getConfigsDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async list(): Promise<string[]> {
    const dir = this.getConfigsDir();
    try {
      const files = await fs.readdir(dir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  async remove(name: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.getConfigsDir(), `${name}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async ensurePrompts(promptMap: Record<string, string>): Promise<void> {
    const dir = this.getPromptsDir();
    await fs.mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(promptMap)) {
      const filePath = path.join(dir, `${name}.md`);
      try {
        await fs.access(filePath);
        // File exists, skip
      } catch {
        await fs.writeFile(filePath, content, 'utf-8');
      }
    }
  }
}
