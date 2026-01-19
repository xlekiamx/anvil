import { execa } from 'execa';
import type {
  DeveloperAgent,
  DeveloperAgentResult,
  AgentContext,
} from '../types.js';

export interface ClaudeDeveloperOptions {
  timeoutMs?: number;
  model?: string;
}

export class ClaudeDeveloperAgent implements DeveloperAgent {
  readonly name = 'claude-code';

  constructor(private readonly options: ClaudeDeveloperOptions = {}) {}

  async execute(context: AgentContext): Promise<DeveloperAgentResult> {
    const start = Date.now();

    // Build the prompt for Claude Code
    const prompt = this.buildPrompt(context);

    try {
      // Build args - simple invocation that works
      const args: string[] = [
        '-p',                               // Print mode (non-interactive)
        '--dangerously-skip-permissions',   // Bypass permission prompts
      ];

      // Add model if specified
      if (this.options.model) {
        args.push('--model', this.options.model);
      }

      // Add separator and prompt (-- protects prompt from being parsed as flags)
      args.push('--', prompt);

      // Debug: log the command
      console.log('[claude-developer] Running:', 'claude', args.slice(0, -1).join(' '), '"<prompt>"');
      console.log('[claude-developer] CWD:', context.repoPath);

      // Invoke Claude Code CLI
      // IMPORTANT: stdin must be set to 'ignore' to prevent Claude from waiting for input
      // This was discovered by analyzing takopi which closes stdin immediately after spawn
      const result = await execa('claude', args, {
        cwd: context.repoPath,
        timeout: this.options.timeoutMs ?? 300000, // 5 min default
        reject: false, // Don't throw on non-zero exit
        stdin: 'ignore', // Critical: prevents Claude from waiting for stdin
        env: {
          ...process.env,
          // Ensure non-interactive
          CI: 'true',
        },
      });

      // Debug: log result
      console.log('[claude-developer] Exit code:', result.exitCode);
      if (result.stderr) console.log('[claude-developer] Stderr:', result.stderr.slice(0, 200));
      if (result.stdout) console.log('[claude-developer] Output:', result.stdout.slice(0, 300));

      const durationMs = Date.now() - start;

      // Check exit code
      if (result.exitCode !== 0) {
        return {
          success: false,
          error: result.stderr || result.stdout || `Claude Code exited with code ${result.exitCode}`,
          durationMs,
        };
      }

      return {
        success: true,
        durationMs,
        annotations: result.stdout.slice(0, 500) || 'Completed',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - start,
      };
    }
  }

  private buildPrompt(context: AgentContext): string {
    const parts: string[] = [];

    // Main instruction
    parts.push('You are a developer agent. Your task is to implement or fix code based on the specification.');
    parts.push('');

    // Spec
    parts.push('## Feature Specification');
    parts.push(context.specContent);
    parts.push('');

    // Issues to fix (if any)
    if (context.reviewOutput && context.reviewOutput.issues.length > 0) {
      parts.push('## Issues to Fix');
      parts.push('The reviewer found the following issues that need to be addressed:');
      parts.push('');
      for (const issue of context.reviewOutput.issues) {
        const location = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : '';
        parts.push(`- [${issue.severity.toUpperCase()}] ${issue.description}${location}`);
      }
      parts.push('');
    }

    // Instructions
    parts.push('## Instructions');
    parts.push('1. Read and understand the specification');
    parts.push('2. Implement the required changes');
    parts.push('3. Make sure all issues from the reviewer are addressed');
    parts.push('4. Commit your changes with a descriptive message');
    parts.push('');
    parts.push('Focus on writing clean, working code. Do not ask questions - make reasonable decisions.');

    return parts.join('\n');
  }
}
