import { useCallback, useRef } from 'react'

interface CircuitBreakerState {
  consecutiveFailures: number
  lastFailureTime: number
  isOpen: boolean
}

export function useCircuitBreaker(threshold: number, timeout: number) {
  const state = useRef<CircuitBreakerState>({
    consecutiveFailures: 0,
    lastFailureTime: 0,
    isOpen: false
  })

  const isCircuitOpen = useCallback((): boolean => {
    const { consecutiveFailures, lastFailureTime, isOpen } = state.current

    if (consecutiveFailures >= threshold) {
      const timeSinceLastFailure = Date.now() - lastFailureTime
      if (timeSinceLastFailure < timeout) {
        return true
      }
      // Reset if timeout has passed
      state.current = {
        consecutiveFailures: 0,
        lastFailureTime: 0,
        isOpen: false
      }
    }
    return false
  }, [threshold, timeout])

  const recordFailure = useCallback(() => {
    state.current.consecutiveFailures++
    state.current.lastFailureTime = Date.now()
    state.current.isOpen = true
  }, [])

  const recordSuccess = useCallback(() => {
    state.current = {
      consecutiveFailures: 0,
      lastFailureTime: 0,
      isOpen: false
    }
  }, [])

  const reset = useCallback(() => {
    state.current = {
      consecutiveFailures: 0,
      lastFailureTime: 0,
      isOpen: false
    }
  }, [])

  return {
    isCircuitOpen,
    recordFailure,
    recordSuccess,
    reset,
    getState: () => ({ ...state.current })
  }
}
