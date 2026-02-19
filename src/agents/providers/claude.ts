import { execa, type ResultPromise } from 'execa';
import type { Worker, WorkerResult, DetectedQuestion } from '../types.js';

/**
 * Types for Claude Code stream-json output format.
 */
export interface ClaudeStreamEvent {
  type: 'system' | 'assistant' | 'user' | 'result';
}

export interface ClaudeSystemEvent extends ClaudeStreamEvent {
  type: 'system';
  subtype: 'init' | string;
  session_id?: string;
}

export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export interface ClaudeThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export type ClaudeContentBlock = ClaudeToolUseBlock | ClaudeTextBlock | ClaudeThinkingBlock;

export interface ClaudeAssistantEvent extends ClaudeStreamEvent {
  type: 'assistant';
  message: { content: ClaudeContentBlock[] };
}

export interface ClaudeResultEvent extends ClaudeStreamEvent {
  type: 'result';
  result?: string;
  is_error?: boolean;
  session_id?: string;
}

export type ClaudeEvent = ClaudeSystemEvent | ClaudeAssistantEvent | ClaudeResultEvent;

export function parseClaudeEvent(line: string): ClaudeEvent | null {
  try {
    const trimmed = line.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed) as ClaudeEvent;
  } catch {
    return null;
  }
}

export function extractSessionId(event: ClaudeEvent): string | undefined {
  if (event.type === 'system' && event.subtype === 'init') return event.session_id;
  if (event.type === 'result') return event.session_id;
  return undefined;
}

export function findAskUserQuestion(event: ClaudeEvent): { question: string; options?: Array<{ label: string; description?: string }> } | null {
  if (event.type !== 'assistant') return null;
  for (const block of event.message.content) {
    if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
      const input = block.input as { question?: string; options?: Array<{ label: string; description?: string }> };
      return {
        question: input.question || 'Please provide more information',
        options: input.options,
      };
    }
  }
  return null;
}

/** Build a clean env that allows nested Claude invocation */
function cleanEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  // Remove CLAUDECODE to allow spawning Claude inside a Claude session
  delete env.CLAUDECODE;
  return env;
}

export interface ClaudeWorkerOptions {
  model?: string;
  interactive?: boolean;
}

export class ClaudeWorker implements Worker {
  readonly name: string;
  private childProcess: ResultPromise | null = null;

  constructor(
    name: string,
    private readonly options: ClaudeWorkerOptions = {}
  ) {
    this.name = name;
  }

  async execute(prompt: string, cwd: string): Promise<WorkerResult> {
    const isCI = process.env.CI === 'true';
    const interactive = this.options.interactive && !isCI;

    if (interactive) {
      return this.executeInteractive(prompt, cwd);
    }
    return this.executeNonInteractive(prompt, cwd);
  }

  kill(): void {
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }
  }

  private async executeNonInteractive(prompt: string, cwd: string): Promise<WorkerResult> {
    const start = Date.now();

    try {
      const args: string[] = ['-p', '--dangerously-skip-permissions'];
      if (this.options.model) args.push('--model', this.options.model);
      args.push('--', prompt);

      this.childProcess = execa('claude', args, {
        cwd,
        reject: false,
        stdin: 'ignore',
        env: { ...cleanEnv(), CI: 'true' },
      });

      const result = await this.childProcess;
      this.childProcess = null;

      const durationMs = Date.now() - start;

      if (result.exitCode !== 0) {
        return {
          success: false,
          output: '',
          error: String(result.stderr || result.stdout || `Claude exited with code ${result.exitCode}`),
          durationMs,
        };
      }

      return {
        success: true,
        output: String(result.stdout ?? ''),
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
    }
  }

  private async executeInteractive(prompt: string, cwd: string): Promise<WorkerResult> {
    const start = Date.now();

    try {
      const args: string[] = [
        '-p',
        '--dangerously-skip-permissions',
        '--verbose',
        '--output-format', 'stream-json',
      ];
      if (this.options.model) args.push('--model', this.options.model);
      args.push('--', prompt);

      const streamResult = await this.streamAndParse(cwd, args);
      const durationMs = Date.now() - start;

      if (streamResult.pendingQuestion) {
        return {
          success: true,
          output: '',
          durationMs,
          pendingQuestion: streamResult.pendingQuestion,
        };
      }

      if (streamResult.error) {
        return {
          success: false,
          output: '',
          error: streamResult.error,
          durationMs,
        };
      }

      return {
        success: true,
        output: streamResult.lastOutput || '',
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
    }
  }

  private async streamAndParse(
    cwd: string,
    args: string[]
  ): Promise<{
    pendingQuestion?: DetectedQuestion;
    lastOutput?: string;
    error?: string;
  }> {
    return new Promise((resolve) => {
      let sessionId: string | undefined;
      let pendingQuestion: DetectedQuestion | undefined;
      let lastOutput: string | undefined;
      let error: string | undefined;
      let buffer = '';

      const proc = execa('claude', args, {
        cwd,
        reject: false,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: cleanEnv(),
      });

      this.childProcess = proc;

      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const event = parseClaudeEvent(line);
          if (!event) continue;

          const sid = extractSessionId(event);
          if (sid) sessionId = sid;

          const question = findAskUserQuestion(event);
          if (question && sessionId) {
            pendingQuestion = {
              sessionId,
              question: question.question,
              options: question.options,
            };
          }

          if (event.type === 'result') {
            if (event.is_error) {
              error = event.result || 'Claude session failed';
            } else {
              lastOutput = event.result;
            }
          }
        }
      });

      let stderrOutput = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      proc.then((result) => {
        this.childProcess = null;

        if (buffer.trim()) {
          const event = parseClaudeEvent(buffer);
          if (event) {
            const sid = extractSessionId(event);
            if (sid) sessionId = sid;
            const question = findAskUserQuestion(event);
            if (question && sessionId) {
              pendingQuestion = { sessionId, question: question.question, options: question.options };
            }
          }
        }

        if (pendingQuestion) {
          resolve({ pendingQuestion });
          return;
        }

        if (result.exitCode !== 0 && !error) {
          error = stderrOutput || `Claude exited with code ${result.exitCode}`;
        }

        resolve({ lastOutput, error });
      }).catch((err) => {
        this.childProcess = null;
        resolve({ error: err instanceof Error ? err.message : 'Unknown error' });
      });
    });
  }
}
