'use client'

import { useEffect, useRef } from 'react'
import { getTriviaEnabled } from '@/app/[username]/admin/components/dashboard/components/trivia-game-toggle'

function getSecondsUntilNextHour(): number {
  const now = new Date()
  const nextHour = new Date(now)
  nextHour.setHours(now.getHours() + 1, 0, 0, 0)
  return Math.max(0, Math.floor((nextHour.getTime() - now.getTime()) / 1000))
}

/**
 * Fires POST /api/trivia/reset at the top of each hour.
 * Must run on the admin page — the only page guaranteed to always be open
 * while the venue is running. The game page must NOT own this responsibility
 * since there is no guarantee any player has it open.
 */
export function useTriviaResetTimer(profileId: string | null): void {
  const isResettingRef = useRef(false)

  useEffect(() => {
    if (!profileId) return

    const start = (): (() => void) => {
      if (!getTriviaEnabled()) return () => {}

      const interval = setInterval(() => {
        const secondsLeft = getSecondsUntilNextHour()

        if (secondsLeft <= 1 && !isResettingRef.current) {
          isResettingRef.current = true
          fetch('/api/trivia/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile_id: profileId })
          })
            .then(async (res) => {
              if (!res.ok) {
                console.warn('[useTriviaResetTimer] reset failed:', res.status)
              }
            })
            .catch((e) => console.warn('[useTriviaResetTimer] reset error:', e))
            .finally(() => {
              setTimeout(() => {
                isResettingRef.current = false
              }, 3000)
            })
        }
      }, 1000)

      return () => clearInterval(interval)
    }

    let cleanup = start()

    const handleToggle = (): void => {
      cleanup()
      cleanup = start()
    }
    window.addEventListener('trivia-enabled-changed', handleToggle)

    return () => {
      cleanup()
      window.removeEventListener('trivia-enabled-changed', handleToggle)
    }
  }, [profileId])
}
