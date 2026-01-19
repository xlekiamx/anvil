import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ReviewOutputSchema, type ReviewOutput } from '../types/review.js';
import { ValidationError } from '../utils/errors.js';
import type { Logger } from '../logger/index.js';

export const REVIEW_OUTPUT_FILE_NAME = 'review-output.json';

export class ReviewOutputFile {
  public readonly path: string;

  constructor(
    aiDir: string,
    private readonly logger: Logger
  ) {
    this.path = path.join(aiDir, REVIEW_OUTPUT_FILE_NAME);
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.path);
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<ReviewOutput | null> {
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

  async write(output: ReviewOutput): Promise<void> {
    const validated = this.validate(output);
    const content = JSON.stringify(validated, null, 2);

    const tempPath = `${this.path}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, this.path);

    this.logger.debug({ path: this.path }, 'Wrote review output file');
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.path);
      this.logger.debug({ path: this.path }, 'Cleared review output file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private validate(data: unknown): ReviewOutput {
    const result = ReviewOutputSchema.safeParse(data);
    if (!result.success) {
      const issues = result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      );
      throw new ValidationError('Invalid review output file', issues);
    }
    return result.data;
  }
}
