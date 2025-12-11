import { useState, useEffect, useCallback, useRef } from 'react'

interface UseGameTimerProps {
  initialTime?: number
  isActive: boolean
}

interface UseGameTimerResult {
  timeRemaining: number
  isExpired: boolean
  reset: () => void
}

export function useGameTimer({
  initialTime = 60,
  isActive
}: UseGameTimerProps): UseGameTimerResult {
  const [timeRemaining, setTimeRemaining] = useState(initialTime)
  const [isExpired, setIsExpired] = useState(false)
  const initialTimeRef = useRef(initialTime)

  // Update ref when initialTime changes
  useEffect(() => {
    initialTimeRef.current = initialTime
  }, [initialTime])

  // Don't auto-reset when isActive becomes true - let explicit reset() handle it
  // This prevents double-resets and flickering

  // Countdown logic
  useEffect(() => {
    if (!isActive || isExpired) {
      return
    }

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setIsExpired(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [isActive, isExpired])

  // Memoize reset function to prevent unnecessary re-renders
  const reset = useCallback(() => {
    setTimeRemaining(initialTimeRef.current)
    setIsExpired(false)
  }, [])

  return {
    timeRemaining,
    isExpired,
    reset
  }
}
