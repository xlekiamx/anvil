import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import type { Worker, WorkerResult } from '../types.js';

export interface CodexWorkerOptions {
  model?: string;
  outputSchema?: Record<string, unknown>;
}

/**
 * Convert a simple output_schema from config into a proper JSON Schema
 * that codex --output-schema understands.
 *
 * Input:  { "approved": "boolean", "issues": [...], "confidence": "number 0-1" }
 * Output: { "type": "object", "properties": { ... }, "required": [...], "additionalProperties": false }
 */
function toJsonSchema(simple: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(simple)) {
    required.push(key);

    if (typeof value === 'string') {
      // Parse type hints like "boolean", "number 0-1", "string", "completed | needs_review"
      const lower = value.toLowerCase().trim();
      if (lower === 'boolean') {
        properties[key] = { type: 'boolean' };
      } else if (lower.startsWith('number')) {
        properties[key] = { type: 'number' };
      } else if (lower.includes('|')) {
        // Enum-like: "completed | needs_review"
        const values = lower.split('|').map(v => v.trim());
        properties[key] = { type: 'string', enum: values };
      } else {
        properties[key] = { type: 'string' };
      }
    } else if (Array.isArray(value)) {
      // Array of objects
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        properties[key] = {
          type: 'array',
          items: toJsonSchema(value[0] as Record<string, unknown>),
        };
      } else {
        properties[key] = { type: 'array' };
      }
    } else {
      properties[key] = { type: 'string' };
    }
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

export class CodexWorker implements Worker {
  readonly name: string;
  private childProcess: ReturnType<typeof execa> | null = null;

  constructor(
    name: string,
    private readonly options: CodexWorkerOptions = {}
  ) {
    this.name = name;
  }

  async execute(prompt: string, cwd: string): Promise<WorkerResult> {
    const start = Date.now();
    let schemaFile: string | null = null;
    let outputFile: string | null = null;

    try {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-codex-'));
      outputFile = path.join(tmpDir, 'output.txt');

      const args = ['exec', '--skip-git-repo-check', '--color=never'];

      // Write output schema to temp file if available
      if (this.options.outputSchema && Object.keys(this.options.outputSchema).length > 0) {
        schemaFile = path.join(tmpDir, 'schema.json');
        const jsonSchema = toJsonSchema(this.options.outputSchema);
        await fs.writeFile(schemaFile, JSON.stringify(jsonSchema, null, 2));
        args.push('--output-schema', schemaFile);
      }

      // Write last message to file for clean output
      args.push('--output-last-message', outputFile);

      if (this.options.model) {
        args.push('-m', this.options.model);
      }

      // Prompt as positional argument
      args.push(prompt);

      this.childProcess = execa('codex', args, {
        cwd,
        reject: false,
        stdin: 'ignore',
      });

      const result = await this.childProcess;
      this.childProcess = null;

      const durationMs = Date.now() - start;

      if (result.exitCode !== 0) {
        return {
          success: false,
          output: '',
          error: String(result.stderr || `Codex exited with code ${result.exitCode}`),
          durationMs,
        };
      }

      // Read structured output from the output file
      let output = '';
      try {
        output = await fs.readFile(outputFile, 'utf-8');
      } catch {
        // Fallback to stdout if file wasn't written
        output = String(result.stdout ?? '');
      }

      return {
        success: true,
        output: output.trim(),
        durationMs,
      };
    } catch (error) {
      this.childProcess = null;
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - start,
      };
    } finally {
      // Clean up temp files
      if (schemaFile) fs.unlink(schemaFile).catch(() => {});
      if (outputFile) fs.unlink(outputFile).catch(() => {});
    }
  }

  kill(): void {
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }
  }
}
