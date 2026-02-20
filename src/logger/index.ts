import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(options?: { level?: string; pretty?: boolean; logFile?: string }): Logger {
  const level = (options?.level ?? 'info') as pino.Level;
  const pretty = options?.pretty ?? process.stdout.isTTY;

  const streams: pino.StreamEntry[] = [];

  // Console stream
  if (pretty) {
    streams.push({
      level,
      stream: pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }),
    });
  } else {
    streams.push({ level, stream: process.stdout });
  }

  // File stream (when verbose)
  if (options?.logFile) {
    streams.push({
      level: 'debug',
      stream: pino.destination(options.logFile),
    });
  }

  return pino({ level }, pino.multistream(streams));
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
