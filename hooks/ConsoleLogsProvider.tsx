import { createContext, useContext, ReactNode } from 'react'
import { useConsoleLogs, LogEntry } from './useConsoleLogs'
import * as Sentry from '@sentry/nextjs'

interface ConsoleLogsContextType {
  logs: LogEntry[]
  addLog: (
    level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
    message: string,
    context?: string,
    error?: Error
  ) => void
  clearLogs: () => void
}

const ConsoleLogsContext = createContext<ConsoleLogsContextType | null>(null)

export function ConsoleLogsProvider({ children }: { children: ReactNode }) {
  const { logs, addLog: originalAddLog, clearLogs } = useConsoleLogs()
  const { logger } = Sentry

  function addLog(
    level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
    message: string,
    context?: string,
    error?: Error
  ) {
    originalAddLog(level, message, context, error)

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
  }

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
