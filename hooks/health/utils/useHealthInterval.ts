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
  const isRunningRef = useRef(false)

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const runCallback = async (): Promise<void> => {
      // Prevent overlapping executions
      if (isRunningRef.current) {
        return
      }
      isRunningRef.current = true
      try {
        await callbackRef.current()
      } catch (error) {
        // Errors are handled by the callback itself, but we catch to prevent unhandled rejections
        console.error('Error in health interval callback:', error)
      } finally {
        isRunningRef.current = false
      }
    }

    // Initial delay if specified
    if (initialDelay > 0) {
      timeoutRef.current = setTimeout(() => {
        void runCallback()
        // Start interval after initial execution
        intervalRef.current = setInterval(() => {
          void runCallback()
        }, interval)
      }, initialDelay)
    } else {
      // Run immediately, then set up interval
      void runCallback()
      intervalRef.current = setInterval(() => {
        void runCallback()
      }, interval)
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
      isRunningRef.current = false
    }
  }, [enabled, interval, initialDelay])
}
