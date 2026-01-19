import { execa } from 'execa';
import type {
  ReviewerAgent,
  ReviewerAgentResult,
  AgentContext,
} from '../types.js';
import type { ReviewOutput, ReviewIssue } from '../../types/review.js';

export interface CodexReviewerOptions {
  timeoutMs?: number;
  model?: string;
}

export class CodexReviewerAgent implements ReviewerAgent {
  readonly name = 'codex-reviewer';

  constructor(private readonly options: CodexReviewerOptions = {}) {}

  async execute(context: AgentContext): Promise<ReviewerAgentResult> {
    const start = Date.now();

    // Build the review prompt
    const prompt = this.buildPrompt(context);

    try {
      // Use codex exec pattern (like takopi) - prompt via stdin
      const args = [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--color=never',
        '-',  // Read prompt from stdin
      ];

      // Add model if specified (before exec)
      if (this.options.model) {
        args.unshift('-m', this.options.model);
      }

      const result = await execa('codex', args, {
        cwd: context.repoPath,
        timeout: this.options.timeoutMs ?? 120000, // 2 min default
        reject: false,
        input: prompt,  // Send prompt via stdin
      });

      const durationMs = Date.now() - start;

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: result.stderr || `Codex exited with code ${result.exitCode}`,
          durationMs,
        };
      }

      // Parse the review output
      const output = this.parseReviewOutput(result.stdout);

      return {
        success: true,
        durationMs,
        output,
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

    parts.push('Review the code changes against this specification:');
    parts.push('');
    parts.push('## Specification');
    parts.push(context.specContent);
    parts.push('');
    parts.push('## Review Instructions');
    parts.push('1. Check if the implementation matches the requirements');
    parts.push('2. Look for bugs, security issues, and code quality problems');
    parts.push('3. Verify edge cases are handled');
    parts.push('');
    parts.push('## Required Output Format');
    parts.push('At the END of your review, output a JSON block with this exact format:');
    parts.push('```json');
    parts.push('{');
    parts.push('  "approved": true/false,');
    parts.push('  "confidence": 0.0-1.0,');
    parts.push('  "issues": [');
    parts.push('    {"id": "R1", "severity": "high|medium|low", "category": "security|correctness|performance|maintainability|architecture", "description": "...", "file": "path/to/file.ts", "line": 42}');
    parts.push('  ],');
    parts.push('  "summary": "Brief summary of the review"');
    parts.push('}');
    parts.push('```');

    return parts.join('\n');
  }

  private parseReviewOutput(stdout: string): ReviewOutput {
    // Try to extract JSON from the output
    const jsonMatch = stdout.match(/```json\s*([\s\S]*?)\s*```/);

    if (jsonMatch?.[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          approved: Boolean(parsed.approved),
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
          issues: Array.isArray(parsed.issues) ? this.normalizeIssues(parsed.issues) : [],
          summary: parsed.summary || 'Review completed',
          request_human: Boolean(parsed.request_human),
        };
      } catch {
        // JSON parse failed, fall through to heuristic
      }
    }

    // Heuristic parsing if no valid JSON found
    return this.heuristicParse(stdout);
  }

  private normalizeIssues(issues: unknown[]): ReviewIssue[] {
    return issues
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map((issue, index) => ({
        id: String(issue.id || `R${index + 1}`),
        severity: this.normalizeSeverity(issue.severity),
        category: this.normalizeCategory(issue.category),
        description: String(issue.description || 'No description'),
        file: typeof issue.file === 'string' ? issue.file : undefined,
        line: typeof issue.line === 'number' ? issue.line : undefined,
      }));
  }

  private normalizeSeverity(severity: unknown): 'critical' | 'high' | 'medium' | 'low' {
    const s = String(severity).toLowerCase();
    if (s === 'critical') return 'critical';
    if (s === 'high') return 'high';
    if (s === 'medium') return 'medium';
    return 'low';
  }

  private normalizeCategory(category: unknown): 'security' | 'correctness' | 'performance' | 'maintainability' | 'architecture' {
    const c = String(category).toLowerCase();
    if (c === 'security') return 'security';
    if (c === 'correctness') return 'correctness';
    if (c === 'performance') return 'performance';
    if (c === 'architecture') return 'architecture';
    return 'maintainability';
  }

  private heuristicParse(stdout: string): ReviewOutput {
    const lower = stdout.toLowerCase();

    // Check for approval signals
    const approved =
      lower.includes('lgtm') ||
      lower.includes('looks good') ||
      lower.includes('approved') ||
      (lower.includes('no issues') && !lower.includes('some issues'));

    // Check for issue signals
    const hasIssues =
      lower.includes('issue') ||
      lower.includes('bug') ||
      lower.includes('problem') ||
      lower.includes('error') ||
      lower.includes('fix');

    return {
      approved: approved && !hasIssues,
      confidence: 0.6, // Lower confidence for heuristic
      issues: hasIssues ? [{
        id: 'R1',
        severity: 'medium',
        category: 'correctness',
        description: 'Review found potential issues - see full output',
      }] : [],
      summary: stdout.slice(0, 200),
      request_human: false,
    };
  }
}
