'use client'

import { useEffect, useRef } from 'react'
import { useUserToken } from '@/hooks/useUserToken'

/**
 * Background polling hook for lazy updates (genre backfill, healing, etc.)
 * Runs periodically while user is on the page
 */
export function useBackgroundUpdates() {
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const { token } = useUserToken()

  useEffect(() => {
    // Poll every 30 seconds
    const POLL_INTERVAL = 30000

    const pollLazyUpdates = async () => {
      try {
        if (!token) {
          // Skip if no token
          return
        }

        const response = await fetch('/api/game/lazy-update-tick', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token
          })
        })

        if (response.ok) {
          await response.json()
        }
      } catch (error) {
        // Silently fail - this is background work
      }
    }

    // Start polling
    intervalRef.current = setInterval(pollLazyUpdates, POLL_INTERVAL)

    // Run once immediately
    pollLazyUpdates()

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [token]) // Re-run when token changes
}
