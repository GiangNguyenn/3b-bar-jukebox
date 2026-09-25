'use client'

import { useEffect, useRef, useState } from 'react'
import { useSpotifyPlayerStore, spotifyPlayerStore } from './useSpotifyPlayer'
import type { PlayerStatus } from './spotifyPlayerStore'
import type { LogLevel } from './ConsoleLogsProvider'

// How long a status may persist before the player is recreated. Failed states
// get a short grace (in-flight auth retries run on a 5s cadence); transitional
// states get longer, since a normal initialization passes through them.
const STUCK_THRESHOLD_MS: Partial<Record<PlayerStatus, number>> = {
  error: 10_000,
  disconnected: 10_000,
  initializing: 45_000,
  verifying: 45_000,
  reconnecting: 45_000
}
const MAX_BACKOFF_MULTIPLIER = 6 // caps the wait at threshold * 6

/**
 * Recreates the Spotify player whenever it has been out of the 'ready' state
 * for too long, with exponential backoff between attempts.
 *
 * Without this, any recovery path that ends in 'error' or 'disconnected'
 * (failed device transfer, exhausted auth retries, a recreate that threw)
 * left the jukebox silent until someone reloaded the page.
 */
export function usePlayerAutoRecovery(
  createPlayer: () => Promise<string | null>,
  addLog: (level: LogLevel, message: string, context?: string) => void,
  enabled: boolean = true
): void {
  const { status, recoveryRequested } = useSpotifyPlayerStore()
  const attemptRef = useRef(0)
  const inFlightRef = useRef(false)
  // Bumped to re-arm the timer when an attempt leaves the status unchanged
  // (the effect would otherwise not run again).
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (status === 'ready') {
      attemptRef.current = 0
      return
    }

    const threshold = STUCK_THRESHOLD_MS[status]
    if (!enabled || threshold === undefined) {
      return
    }

    // A confirmed lost device can't come back by itself: rebuild right away
    // on the first attempt. Later attempts still back off.
    const delay =
      recoveryRequested && attemptRef.current === 0
        ? 0
        : threshold * Math.min(2 ** attemptRef.current, MAX_BACKOFF_MULTIPLIER)
    const timer = setTimeout(() => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      attemptRef.current++
      addLog(
        'WARN',
        delay === 0
          ? `Player lost its Spotify device — recreating it now`
          : `Player has been '${status}' for ${Math.round(delay / 1000)}s — recreating it (attempt ${attemptRef.current})`,
        'PlayerAutoRecovery'
      )
      void createPlayer()
        .catch(() => null)
        .finally(() => {
          inFlightRef.current = false
          if (spotifyPlayerStore.getState().status === status) {
            setRetryTick((t) => t + 1)
          }
        })
    }, delay)

    return () => clearTimeout(timer)
  }, [status, recoveryRequested, retryTick, enabled, createPlayer, addLog])
}
