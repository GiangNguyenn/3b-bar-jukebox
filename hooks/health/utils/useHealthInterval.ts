import { useEffect, useRef } from 'react'

/**
 * Options for useHealthInterval hook
 */
export interface UseHealthIntervalOptions {
  /** Interval in milliseconds */
  interval: number
  /** Whether the interval is enabled */
  enabled?: boolean
  /** Delay before starting the interval (in milliseconds) */
  initialDelay?: number
}

/**
 * Hook for managing intervals in health monitoring hooks
 * Automatically handles cleanup and provides abort signal checking
 */
export function useHealthInterval(
  callback: () => void | Promise<void>,
  options: UseHealthIntervalOptions
): void {
  const { interval, enabled = true, initialDelay = 0 } = options
  const callbackRef = useRef(callback)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const runCallback = (): void => {
      void callbackRef.current()
    }

    // Initial delay if specified
    if (initialDelay > 0) {
      timeoutRef.current = setTimeout(() => {
        runCallback()
        // Start interval after initial execution
        intervalRef.current = setInterval(runCallback, interval)
      }, initialDelay)
    } else {
      // Run immediately, then set up interval
      runCallback()
      intervalRef.current = setInterval(runCallback, interval)
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, interval, initialDelay])
}

