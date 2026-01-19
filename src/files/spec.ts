import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileError } from '../utils/errors.js';
import type { Logger } from '../logger/index.js';

export const SPEC_FILE_NAME = 'SPEC.md';

const DEFAULT_SPEC_TEMPLATE = `# Feature Specification

## Requirements

<!-- Describe what needs to be implemented -->

## Acceptance Criteria

- [ ] Criteria 1
- [ ] Criteria 2

## Notes

<!-- Additional context or constraints -->
`;

export class SpecFile {
  public readonly path: string;

  constructor(
    aiDir: string,
    private readonly logger: Logger
  ) {
    this.path = path.join(aiDir, SPEC_FILE_NAME);
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.path);
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<string | null> {
    try {
      return await fs.readFile(this.path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async write(content: string): Promise<void> {
    const tempPath = `${this.path}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, this.path);

    this.logger.debug({ path: this.path }, 'Wrote spec file');
  }

  async initialize(content?: string): Promise<string> {
    const spec = content ?? DEFAULT_SPEC_TEMPLATE;
    await this.write(spec);
    this.logger.info('Initialized spec file');
    return spec;
  }

  async readOrThrow(): Promise<string> {
    const content = await this.read();
    if (content === null) {
      throw new FileError('Spec file not found', this.path);
    }
    return content;
  }
}
