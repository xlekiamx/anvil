import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StatusSchema, type Status, createInitialStatus } from '../types/status.js';
import { FileError, ValidationError } from '../utils/errors.js';
import type { Logger } from '../logger/index.js';

export const STATUS_FILE_NAME = 'status.json';

export class StatusFile {
  public readonly path: string;

  constructor(
    aiDir: string,
    private readonly logger: Logger
  ) {
    this.path = path.join(aiDir, STATUS_FILE_NAME);
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.path);
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<Status | null> {
    try {
      const content = await fs.readFile(this.path, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return this.validate(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async write(status: Status): Promise<void> {
    const validated = this.validate(status);
    const content = JSON.stringify(validated, null, 2);

    // Atomic write: write to temp file then rename
    const tempPath = `${this.path}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, this.path);

    this.logger.debug({ path: this.path }, 'Wrote status file');
  }

  async initialize(featureId: string): Promise<Status> {
    const status = createInitialStatus(featureId);
    await this.write(status);
    this.logger.info({ featureId }, 'Initialized status file');
    return status;
  }

  async update(updates: Partial<Status>): Promise<Status> {
    const current = await this.read();
    if (!current) {
      throw new FileError('Status file not found', this.path);
    }

    const updated: Status = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    await this.write(updated);
    return updated;
  }

  async updateAnnotations(annotations: string): Promise<Status> {
    return this.update({ annotations });
  }

  private validate(data: unknown): Status {
    const result = StatusSchema.safeParse(data);
    if (!result.success) {
      const issues = result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      );
      throw new ValidationError('Invalid status file', issues);
    }
    return result.data;
  }
}
