import type { Config } from '../types/config.js';
import type { AgentFactory, DeveloperAgent, ReviewerAgent } from './types.js';
import { MockDeveloperAgent } from './mock/developer.js';
import { MockReviewerAgent } from './mock/reviewer.js';
import { ClaudeDeveloperAgent } from './real/claude-developer.js';
import { CodexReviewerAgent } from './real/codex-reviewer.js';

export class DefaultAgentFactory implements AgentFactory {
  createDeveloper(config: Config): DeveloperAgent {
    const agentConfig = config.agents.developer;

    switch (agentConfig.type) {
      case 'mock':
        return new MockDeveloperAgent();
      case 'claude':
        return new ClaudeDeveloperAgent({
          timeoutMs: agentConfig.timeout_seconds * 1000,
        });
      default:
        throw new Error(`Unknown developer agent type: ${agentConfig.type}`);
    }
  }

  createReviewer(config: Config): ReviewerAgent {
    const agentConfig = config.agents.reviewer;

    switch (agentConfig.type) {
      case 'mock':
        return new MockReviewerAgent();
      case 'codex':
        return new CodexReviewerAgent({
          timeoutMs: agentConfig.timeout_seconds * 1000,
        });
      default:
        throw new Error(`Unknown reviewer agent type: ${agentConfig.type}`);
    }
  }
}
