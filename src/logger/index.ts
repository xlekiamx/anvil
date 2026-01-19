import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(options?: { level?: string; pretty?: boolean }): Logger {
  const level = options?.level ?? 'info';
  const pretty = options?.pretty ?? process.stdout.isTTY;

  if (pretty) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino({ level });
}

let defaultLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = createLogger();
  }
  return defaultLogger;
}

export function setLogger(logger: Logger): void {
  defaultLogger = logger;
}
