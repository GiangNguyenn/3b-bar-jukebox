import { useState, useEffect, useRef } from 'react'

export function useConsoleLogs() {
  const [logs, setLogs] = useState<string[]>([])
  const isUpdating = useRef(false)
  const originalConsole = useRef<{
    log: typeof console.log
    error: typeof console.error
  }>()

  useEffect(() => {
    if (!originalConsole.current) {
      originalConsole.current = {
        log: console.log,
        error: console.error
      }

      console.log = (...args: unknown[]) => {
        originalConsole.current?.log(...args)
        if (!isUpdating.current) {
          isUpdating.current = true
          setLogs((prev) => [...prev.slice(-9), args.join(' ')])
          isUpdating.current = false
        }
      }

      console.error = (...args: unknown[]) => {
        originalConsole.current?.error(...args)
        if (!isUpdating.current) {
          isUpdating.current = true
          setLogs((prev) => [...prev.slice(-9), `[ERROR] ${args.join(' ')}`])
          isUpdating.current = false
        }
      }
    }

    return () => {
      if (originalConsole.current) {
        console.log = originalConsole.current.log
        console.error = originalConsole.current.error
      }
    }
  }, [])

  return logs
}
