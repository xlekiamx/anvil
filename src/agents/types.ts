import type { Status } from '../types/status.js';
import type { Config } from '../types/config.js';
import type { ReviewOutput } from '../types/review.js';

export interface AgentContext {
  repoPath: string;
  aiDir: string;
  status: Status;
  config: Config;
  specContent: string;
  reviewOutput?: ReviewOutput;
}

export interface AgentResult {
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface DeveloperAgentResult extends AgentResult {
  filesChanged?: string[];
  annotations?: string;
}

export interface ReviewerAgentResult extends AgentResult {
  output?: ReviewOutput;
}

export interface DeveloperAgent {
  readonly name: string;
  execute(context: AgentContext): Promise<DeveloperAgentResult>;
}

export interface ReviewerAgent {
  readonly name: string;
  execute(context: AgentContext): Promise<ReviewerAgentResult>;
}

export interface AgentFactory {
  createDeveloper(config: Config): DeveloperAgent;
  createReviewer(config: Config): ReviewerAgent;
}
