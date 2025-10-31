'use client'

import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react'
import * as Sentry from '@sentry/nextjs'
import { initializeLoggers, setLogger } from '@/shared/utils/logger'

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

interface ConsoleLogsProviderProps {
  maxLogs?: number
  enableConsoleOverride?: boolean
  enableSentry?: boolean
  rateLimit?: number
  maxMessageLength?: number
}

const ConsoleLogsContext = createContext<ConsoleLogsContextType | null>(null)

const DEFAULT_MAX_LOGS = 50
const DEFAULT_RATE_LIMIT = 1000 // ms
const DEFAULT_MAX_MESSAGE_LENGTH = 1000

export function ConsoleLogsProvider({
  children,
  maxLogs = DEFAULT_MAX_LOGS,
  enableConsoleOverride = false,
  enableSentry = true,
  rateLimit = DEFAULT_RATE_LIMIT,
  maxMessageLength = DEFAULT_MAX_MESSAGE_LENGTH
}: ConsoleLogsProviderProps & { children: ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const loggerRef = useRef(Sentry.logger)
  const isConsoleOverridden = useRef(false)
  const setLogsRef = useRef(setLogs)
  const lastLogTime = useRef(0)

  // Update ref when setLogs changes
  useEffect(() => {
    setLogsRef.current = setLogs
  }, [setLogs])

  const validateMessage = useCallback(
    (message: string): string => {
      if (message.length > maxMessageLength) {
        return message.slice(0, maxMessageLength) + '...'
      }
      return message
    },
    [maxMessageLength]
  )

  const logToSentry = useCallback(
    (level: LogLevel, message: string, context?: string, error?: Error) => {
      if (!enableSentry) return

      try {
        if (level === 'ERROR') {
          loggerRef.current.error(message, { context, error })
        } else if (level === 'WARN') {
          loggerRef.current.warn(message, { context, error })
        }
      } catch (e) {
        console.error('Failed to log to Sentry:', e)
      }
    },
    [enableSentry]
  )

  const addLog = useCallback(
    (level: LogLevel, message: string, context?: string, error?: Error) => {
      // Filter out LOG and INFO levels - only process WARN and ERROR
      if (level === 'LOG' || level === 'INFO') {
        return
      }

      const now = Date.now()
      if (now - lastLogTime.current < rateLimit) {
        return
      }
      lastLogTime.current = now

      const timestamp = new Date().toISOString()
      const sanitizedMessage = validateMessage(message)
      const newLog = {
        timestamp,
        level,
        message: sanitizedMessage,
        context,
        error
      }

      setLogsRef.current((prev) => {
        const updatedLogs = [newLog, ...prev]
        return updatedLogs.slice(0, maxLogs)
      })

      const consoleMethod = level.toLowerCase() as 'warn' | 'error'
      const consoleArgs = context
        ? [`[${context}]`, sanitizedMessage, error].filter(Boolean)
        : [sanitizedMessage, error].filter(Boolean)

      switch (consoleMethod) {
        case 'warn':
          console.warn(...consoleArgs)
          break
        case 'error':
          console.error(...consoleArgs)
          break
      }

      logToSentry(level, sanitizedMessage, context, error)
    },
    [rateLimit, validateMessage, logToSentry, maxLogs]
  )

  useEffect(() => {
    setLogger(addLog)
    initializeLoggers(addLog)
  }, [addLog])

  useEffect(() => {
    let didRun = false
    const timeout = setTimeout(() => {
      if (!enableConsoleOverride || isConsoleOverridden.current) return
      isConsoleOverridden.current = true

      const originalConsoleWarn = console.warn
      const originalConsoleError = console.error

      function addLogFromConsole(level: LogLevel, ...args: unknown[]): void {
        const [firstArg, ...restArgs] = args

        let context: string | undefined
        let message: string
        let error: Error | undefined

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

        const lastArg = args[args.length - 1]
        if (lastArg instanceof Error) {
          error = lastArg
        }

        addLog(level, message, context, error)
      }

      console.warn = (...args: unknown[]): void => {
        originalConsoleWarn.apply(console, args)
        addLogFromConsole('WARN', ...args)
      }

      console.error = (...args: unknown[]): void => {
        originalConsoleError.apply(console, args)
        addLogFromConsole('ERROR', ...args)
      }

      didRun = true
      return () => {
        console.warn = originalConsoleWarn
        console.error = originalConsoleError
        isConsoleOverridden.current = false
      }
    }, 0)
    return () => {
      clearTimeout(timeout)
      if (didRun) {
        isConsoleOverridden.current = false
      }
    }
  }, [enableConsoleOverride, addLog])

  const clearLogs = useCallback(() => setLogsRef.current([]), [])

  const contextValue = useMemo(
    () => ({ logs, addLog, clearLogs }),
    [logs, addLog, clearLogs]
  )

  return (
    <ConsoleLogsContext.Provider value={contextValue}>
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
