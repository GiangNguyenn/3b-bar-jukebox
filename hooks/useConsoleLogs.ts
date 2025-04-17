import { useState, useEffect } from 'react'

export type LogLevel = 'LOG' | 'INFO' | 'WARN' | 'ERROR'
export type LogEntry = {
  timestamp: string
  level: LogLevel
  message: string
  context?: string
  error?: Error
}

interface ConsoleLogsState {
  logs: LogEntry[]
  addLog: (
    level: LogLevel,
    message: string,
    context?: string,
    error?: Error
  ) => void
  clearLogs: () => void
}

export function useConsoleLogs(): ConsoleLogsState {
  const [logs, setLogs] = useState<LogEntry[]>([])

  useEffect(() => {
    const originalConsoleLog = console.log
    const originalConsoleInfo = console.info
    const originalConsoleWarn = console.warn
    const originalConsoleError = console.error

    function addLog(level: LogLevel, ...args: unknown[]): void {
      const timestamp = new Date().toISOString()
      const [firstArg, ...restArgs] = args

      let context: string | undefined
      let message: string
      let error: Error | undefined

      // Handle different argument patterns
      if (
        typeof firstArg === 'string' &&
        firstArg.startsWith('[') &&
        firstArg.endsWith(']')
      ) {
        context = firstArg.slice(1, -1)
        message = restArgs
          .map((arg) =>
            arg instanceof Error
              ? arg.message
              : typeof arg === 'object'
                ? JSON.stringify(arg)
                : String(arg)
          )
          .join(' ')
      } else {
        message = args
          .map((arg) =>
            arg instanceof Error
              ? arg.message
              : typeof arg === 'object'
                ? JSON.stringify(arg)
                : String(arg)
          )
          .join(' ')
      }

      // Extract error if present
      const lastArg = args[args.length - 1]
      if (lastArg instanceof Error) {
        error = lastArg
      }

      setLogs((prev) => [
        ...prev,
        { timestamp, level, message, context, error }
      ])
    }

    // Override console methods
    console.log = (...args: unknown[]): void => {
      originalConsoleLog.apply(console, args)
      addLog('LOG', ...args)
    }

    console.info = (...args: unknown[]): void => {
      originalConsoleInfo.apply(console, args)
      addLog('INFO', ...args)
    }

    console.warn = (...args: unknown[]): void => {
      originalConsoleWarn.apply(console, args)
      addLog('WARN', ...args)
    }

    console.error = (...args: unknown[]): void => {
      originalConsoleError.apply(console, args)
      addLog('ERROR', ...args)
    }

    // Cleanup
    return () => {
      console.log = originalConsoleLog
      console.info = originalConsoleInfo
      console.warn = originalConsoleWarn
      console.error = originalConsoleError
    }
  }, [])

  const clearLogs = () => setLogs([])

  return {
    logs,
    addLog: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => {
      const timestamp = new Date().toISOString()
      setLogs((prev) => [
        ...prev,
        { timestamp, level, message, context, error }
      ])
    },
    clearLogs
  }
}
