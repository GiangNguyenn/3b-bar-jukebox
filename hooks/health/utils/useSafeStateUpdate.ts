import { useCallback, useRef, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/**
 * Hook for safe state updates that check if component is still mounted
 * Uses an AbortController signal to track mount status
 */
export function useSafeStateUpdate<T>(
  abortSignal: AbortSignal,
  setState: Dispatch<SetStateAction<T>>
): (newState: T) => void {
  return useCallback(
    (newState: T) => {
      if (!abortSignal.aborted) {
        setState(newState)
      }
    },
    [abortSignal, setState]
  )
}

/**
 * Hook that creates an AbortController and provides safe state update function
 * Automatically aborts on unmount
 */
export function useHealthAbortController(): {
  signal: AbortSignal
  abort: () => void
  isAborted: () => boolean
} {
  const abortControllerRef = useRef<AbortController | null>(null)

  // Create abort controller on mount
  if (!abortControllerRef.current) {
    abortControllerRef.current = new AbortController()
  }

  // Abort on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  return {
    signal: abortControllerRef.current.signal,
    abort: () => abortControllerRef.current?.abort(),
    isAborted: () => abortControllerRef.current?.signal.aborted ?? false
  }
}

