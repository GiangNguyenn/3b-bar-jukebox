import { useState, useEffect, useRef } from 'react'

export function useConsoleLogs(): string[] {
  const [logs, setLogs] = useState<string[]>([])
  const isUpdating = useRef(false)
  const originalConsole = useRef<{
    log: typeof console.log
    error: typeof console.error
  }>()

  useEffect((): (() => void) => {
    if (!originalConsole.current) {
      originalConsole.current = {
        log: console.log,
        error: console.error,
      }

      console.log = (...args: unknown[]): void => {
        originalConsole.current?.log(...args)
        if (!isUpdating.current) {
          isUpdating.current = true
          setLogs((prev) => [...prev.slice(-9), args.join(' ')])
          isUpdating.current = false
        }
      }

      console.error = (...args: unknown[]): void => {
        originalConsole.current?.error(...args)
        if (!isUpdating.current) {
          isUpdating.current = true
          setLogs((prev) => [...prev.slice(-9), `[ERROR] ${args.join(' ')}`])
          isUpdating.current = false
        }
      }
    }

    return (): void => {
      if (originalConsole.current) {
        console.log = originalConsole.current.log
        console.error = originalConsole.current.error
      }
    }
  }, [])

  return logs
}
