export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface StructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const MAX_LOG_HISTORY = 400;
let logHistory: StructuredLogEntry[] = [];

function writeLog(level: LogLevel, module: string, message: string, context?: Record<string, unknown>): void {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
  logHistory.push(entry);
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory = logHistory.slice(-MAX_LOG_HISTORY);
  }

  const prefix = `[${module}] ${message}`;
  if (level === 'error') {
    console.error(prefix, context ?? '');
  } else if (level === 'warn') {
    console.warn(prefix, context ?? '');
  } else if (level === 'info') {
    console.info(prefix, context ?? '');
  } else if (import.meta.env?.DEV) {
    console.debug(prefix, context ?? '');
  }
}

export function createLogger(module: string): StructuredLogger {
  const normalizedModule = String(module || 'app').trim() || 'app';
  return {
    debug(message, context) {
      writeLog('debug', normalizedModule, message, context);
    },
    info(message, context) {
      writeLog('info', normalizedModule, message, context);
    },
    warn(message, context) {
      writeLog('warn', normalizedModule, message, context);
    },
    error(message, context) {
      writeLog('error', normalizedModule, message, context);
    },
  };
}

export function getStructuredLogHistory(module?: string): readonly StructuredLogEntry[] {
  if (!module) return logHistory;
  return logHistory.filter((entry) => entry.module === module);
}

export function clearStructuredLogHistory(): void {
  logHistory = [];
}
