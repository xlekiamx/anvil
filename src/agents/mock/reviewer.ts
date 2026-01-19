import type {
  ReviewerAgent,
  ReviewerAgentResult,
  AgentContext,
} from '../types.js';
import type { ReviewOutput, ReviewIssue } from '../../types/review.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MockReviewerOptions {
  delayMs?: number;
  shouldFail?: boolean;
  approveAfterIterations?: number;
  issues?: ReviewIssue[];
  confidence?: number;
  requestHuman?: boolean;
}

export class MockReviewerAgent implements ReviewerAgent {
  readonly name = 'mock-reviewer';

  constructor(private readonly options: MockReviewerOptions = {}) {}

  async execute(context: AgentContext): Promise<ReviewerAgentResult> {
    const start = Date.now();

    // Simulate work
    await sleep(this.options.delayMs ?? 50);

    // General failure mode
    if (this.options.shouldFail) {
      return {
        success: false,
        error: 'Mock reviewer failure',
        durationMs: Date.now() - start,
      };
    }

    const approveAfter = this.options.approveAfterIterations ?? 2;
    const shouldApprove = context.status.iteration >= approveAfter;

    const defaultIssues: ReviewIssue[] = [
      {
        id: 'R1',
        severity: 'medium',
        category: 'correctness',
        description: 'Mock issue: needs improvement',
        file: 'src/mock.ts',
        line: 10,
      },
    ];

    const output: ReviewOutput = {
      approved: shouldApprove,
      issues: shouldApprove ? [] : (this.options.issues ?? defaultIssues),
      summary: shouldApprove
        ? 'All issues resolved, feature approved'
        : `Found ${(this.options.issues ?? defaultIssues).length} issue(s)`,
      confidence: this.options.confidence ?? 0.85,
      request_human: this.options.requestHuman ?? false,
    };

    return {
      success: true,
      durationMs: Date.now() - start,
      output,
    };
  }
}
