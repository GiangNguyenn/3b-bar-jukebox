import { useState, useEffect } from 'react'

export function useConsoleLogs(): string[] {
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    const originalConsoleLog = console.log
    const originalConsoleInfo = console.info
    const originalConsoleWarn = console.warn
    const originalConsoleError = console.error

    function addLog(type: string, ...args: unknown[]): void {
      const timestamp = new Date().toISOString()
      const message = args
        .map((arg) => {
          if (typeof arg === 'string') return arg
          if (arg instanceof Error) return arg.message
          return JSON.stringify(arg)
        })
        .join(' ')
      setLogs((prev) => [...prev, `[${timestamp}] [${type}] ${message}`])
    }

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

    return () => {
      console.log = originalConsoleLog
      console.info = originalConsoleInfo
      console.warn = originalConsoleWarn
      console.error = originalConsoleError
    }
  }, [])

  return logs
}
