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
