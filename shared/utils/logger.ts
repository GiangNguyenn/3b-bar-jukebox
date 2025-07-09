import { LogEntry } from '@/hooks/ConsoleLogsProvider'

export type LogFunction = (
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context?: string,
  error?: Error
) => void

let resolveLogger: (value: LogFunction) => void

const loggerPromise = new Promise<LogFunction>((resolve) => {
  resolveLogger = resolve
})

export function setLogger(logger: LogFunction) {
  if (resolveLogger) {
    resolveLogger(logger)
  }
}

export function getLogger(): Promise<LogFunction> {
  return loggerPromise
}

// This function is kept for compatibility, but the new
// promise-based approach is preferred.
export function initializeLoggers(logFunction: LogFunction) {
  // You can add other logger initializations here if needed
}

export function createModuleLogger(moduleName: string) {
  return (
    level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
    message: string,
    context?: string,
    error?: Error
  ) => {
    getLogger().then((logger) => {
      logger(level, `[${moduleName}] ${message}`, context || moduleName, error)
    })
  }
}
