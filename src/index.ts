// Types
export type { Status, CurrentTask, ReviewIssue, PendingQuestion, QuestionOption } from './types/status.js';
export type { Config, WorkerConfig, Provider, LoopMode, Behavior } from './types/config.js';

// Schemas
export { StatusSchema, CurrentTaskSchema, ReviewIssueSchema, PendingQuestionSchema, createInitialStatus } from './types/status.js';
export { ConfigSchema, WorkerConfigSchema, ProviderSchema, LoopModeSchema, BehaviorSchema, getDefaultConfig } from './types/config.js';

// Core
export { StateMachine } from './core/state-machine.js';
export { Orchestrator } from './core/orchestrator.js';
export type { OrchestratorResult, OrchestratorDependencies } from './core/orchestrator.js';
export { createAnvilContext, createOrchestrator } from './core/factory.js';
export type { AnvilContext } from './core/factory.js';
export { buildPrompt } from './core/prompt-builder.js';
export type { PromptContext } from './core/prompt-builder.js';
export { parseOutput, validateOutput } from './core/output-parser.js';

// Files
export { AiDirectory, AI_DIR_NAME } from './files/ai-directory.js';
export { StatusFile, STATUS_FILE_NAME } from './files/status.js';
export { ConfigFile, getConfigFileName } from './files/config.js';

// Agents
export type { Worker, WorkerResult, DetectedQuestion, QuestionHandler } from './agents/types.js';
export { MockWorker } from './agents/providers/mock.js';
export { ClaudeWorker } from './agents/providers/claude.js';
export { CodexWorker } from './agents/providers/codex.js';
export { createWorker, createWorkers } from './agents/factory.js';

// Logger
export { createLogger, getLogger, setLogger } from './logger/index.js';
export type { Logger } from './logger/index.js';

// Errors
export {
  AnvilError,
  ConfigError,
  StateError,
  StateTransitionError,
  FileError,
  ValidationError,
  AgentError,
  MaxIterationsError,
  HumanRequiredError,
} from './utils/errors.js';

// CLI
export { createCli } from './cli/index.js';
