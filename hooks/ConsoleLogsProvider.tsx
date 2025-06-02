'use client'

import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useCallback
} from 'react'
import * as Sentry from '@sentry/nextjs'

export type LogLevel = 'LOG' | 'INFO' | 'WARN' | 'ERROR'
export type LogEntry = {
  timestamp: string
  level: LogLevel
  message: string
  context?: string
  error?: Error
}

interface ConsoleLogsContextType {
  logs: LogEntry[]
  addLog: (
    level: LogLevel,
    message: string,
    context?: string,
    error?: Error
  ) => void
  clearLogs: () => void
}

const ConsoleLogsContext = createContext<ConsoleLogsContextType | null>(null)

const MAX_LOGS = 50

export function ConsoleLogsProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const { logger } = Sentry

  const addLog = useCallback(
    (level: LogLevel, message: string, context?: string, error?: Error) => {
      const timestamp = new Date().toISOString()
      setLogs((prev) => {
        const newLog = { timestamp, level, message, context, error }
        const updatedLogs = [...prev, newLog]
        return updatedLogs.slice(-MAX_LOGS)
      })

      // Only send errors and warnings to Sentry
      if (level === 'ERROR') {
        if (error) {
          logger.error(message, { context, error })
        } else {
          logger.error(message, { context })
        }
      } else if (level === 'WARN') {
        if (error) {
          logger.warn(message, { context, error })
        } else {
          logger.warn(message, { context })
        }
      }
    },
    [logger]
  )

  useEffect(() => {
    const originalConsoleLog = console.log
    const originalConsoleInfo = console.info
    const originalConsoleWarn = console.warn
    const originalConsoleError = console.error

    function addLogFromConsole(level: LogLevel, ...args: unknown[]): void {
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

      setLogs((prev) => {
        const newLog = { timestamp, level, message, context, error }
        const updatedLogs = [...prev, newLog]
        return updatedLogs.slice(-MAX_LOGS)
      })

      // Sentry integration for console.warn/error
      if (level === 'ERROR') {
        if (error) {
          logger.error(message, { context, error })
        } else {
          logger.error(message, { context })
        }
      } else if (level === 'WARN') {
        if (error) {
          logger.warn(message, { context, error })
        } else {
          logger.warn(message, { context })
        }
      }
    }

    // Override console methods
    console.log = (...args: unknown[]): void => {
      originalConsoleLog.apply(console, args)
      addLogFromConsole('LOG', ...args)
    }

    console.info = (...args: unknown[]): void => {
      originalConsoleInfo.apply(console, args)
      addLogFromConsole('INFO', ...args)
    }

    console.warn = (...args: unknown[]): void => {
      originalConsoleWarn.apply(console, args)
      addLogFromConsole('WARN', ...args)
    }

    console.error = (...args: unknown[]): void => {
      originalConsoleError.apply(console, args)
      addLogFromConsole('ERROR', ...args)
    }

    // Cleanup
    return () => {
      console.log = originalConsoleLog
      console.info = originalConsoleInfo
      console.warn = originalConsoleWarn
      console.error = originalConsoleError
    }
  }, [logger])

  const clearLogs = () => setLogs([])

  return (
    <ConsoleLogsContext.Provider value={{ logs, addLog, clearLogs }}>
      {children}
    </ConsoleLogsContext.Provider>
  )
}

export function useConsoleLogsContext() {
  const context = useContext(ConsoleLogsContext)
  if (!context) {
    throw new Error(
      'useConsoleLogsContext must be used within a ConsoleLogsProvider'
    )
  }
  return context
}
