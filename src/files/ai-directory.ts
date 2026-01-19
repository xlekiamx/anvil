import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '../logger/index.js';

export const AI_DIR_NAME = '.ai';

export class AiDirectory {
  public readonly path: string;

  constructor(
    repoPath: string,
    private readonly logger: Logger
  ) {
    this.path = path.join(repoPath, AI_DIR_NAME);
  }

  async exists(): Promise<boolean> {
    try {
      const stat = await fs.stat(this.path);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async create(): Promise<void> {
    const exists = await this.exists();
    if (exists) {
      this.logger.debug({ path: this.path }, 'AI directory already exists');
      return;
    }

    await fs.mkdir(this.path, { recursive: true });
    this.logger.info({ path: this.path }, 'Created AI directory');
  }

  async ensureExists(): Promise<void> {
    if (!(await this.exists())) {
      await this.create();
    }
  }

  getFilePath(filename: string): string {
    return path.join(this.path, filename);
  }
}
