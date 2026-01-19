export class AnvilError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'AnvilError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigError extends AnvilError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', false);
    this.name = 'ConfigError';
  }
}

export class StateError extends AnvilError {
  constructor(message: string) {
    super(message, 'STATE_ERROR', false);
    this.name = 'StateError';
  }
}

export class StateTransitionError extends StateError {
  constructor(from: string, to: string) {
    super(`Invalid transition from '${from}' to '${to}'`);
    this.name = 'StateTransitionError';
  }
}

export class FileError extends AnvilError {
  constructor(message: string, public readonly filePath: string) {
    super(message, 'FILE_ERROR', false);
    this.name = 'FileError';
  }
}

export class ValidationError extends AnvilError {
  constructor(message: string, public readonly issues: string[]) {
    super(message, 'VALIDATION_ERROR', false);
    this.name = 'ValidationError';
  }
}

export class AgentError extends AnvilError {
  constructor(
    public readonly agentName: string,
    message: string,
    recoverable = true
  ) {
    super(`Agent '${agentName}' failed: ${message}`, 'AGENT_ERROR', recoverable);
    this.name = 'AgentError';
  }
}

export class MaxIterationsError extends AnvilError {
  constructor(iterations: number, maxIterations: number) {
    super(
      `Maximum iterations reached (${iterations}/${maxIterations})`,
      'MAX_ITERATIONS',
      false
    );
    this.name = 'MaxIterationsError';
  }
}

export class HumanRequiredError extends AnvilError {
  constructor(reason: string) {
    super(`Human intervention required: ${reason}`, 'HUMAN_REQUIRED', false);
    this.name = 'HumanRequiredError';
  }
}
