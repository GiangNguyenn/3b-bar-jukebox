'use client'

import { useEffect, useRef, useState } from 'react'
import { useSpotifyPlayerStore, spotifyPlayerStore } from './useSpotifyPlayer'
import type { PlayerStatus } from './spotifyPlayerStore'
import type { LogLevel } from './ConsoleLogsProvider'
import { describeTabVisibility } from '@/shared/utils/tabVisibility'
import { playerLifecycleService } from '@/services/playerLifecycle'

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

// A confirmed lost device is recovered by reloading the page straight away:
// in the field, players rebuilt in place got device ids Spotify never listed
// (4 of 4 failed, Oct 2026), while every reload was ready within seconds.
// Other failures are rebuilt in place, and if the player is still not 'ready'
// after this long, the page is reloaded as a last resort.
const PAGE_RELOAD_AFTER_MS = 90_000
// At most one automatic reload per this long, so a problem a reload does not
// fix (Spotify down, account trouble) cannot turn into a reload loop
const PAGE_RELOAD_MIN_INTERVAL_MS = 10 * 60_000
const PAGE_RELOAD_KEY = 'jukebox:playerAutoRecovery:lastPageReload'

/** Reads and claims the reload budget. False when storage is unavailable. */
function claimPageReload(now: number): boolean {
  try {
    const last = Number(sessionStorage.getItem(PAGE_RELOAD_KEY) ?? 0)
    if (now - last < PAGE_RELOAD_MIN_INTERVAL_MS) return false
    sessionStorage.setItem(PAGE_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

/**
 * Reloads the page to recover the player, carrying over what to resume.
 * Returns false, doing nothing, when offline (a reload would leave a browser
 * error page that cannot recover by itself) or when the reload budget is
 * spent.
 */
function tryPageReload(
  addLog: (level: LogLevel, message: string, context?: string) => void,
  message: string
): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false
  }
  if (!claimPageReload(Date.now())) return false
  addLog('WARN', message, 'PlayerAutoRecovery')
  playerLifecycleService.prepareForPageReload()
  window.location.reload()
  return true
}

/**
 * Recreates the Spotify player whenever it has been out of the 'ready' state
 * for too long, with exponential backoff between attempts.
 *
 * Without this, any recovery path that ends in 'error' or 'disconnected'
 * (failed device transfer, exhausted auth retries, a recreate that threw)
 * left the jukebox silent until someone reloaded the page. A confirmed lost
 * device reloads the page at once; otherwise, if the player is still not
 * 'ready' PAGE_RELOAD_AFTER_MS after it left that state, the page is
 * reloaded. Either way at most once per PAGE_RELOAD_MIN_INTERVAL_MS; when
 * that budget is spent, the player is rebuilt in place instead.
 */
export function usePlayerAutoRecovery(
  createPlayer: () => Promise<string | null>,
  addLog: (level: LogLevel, message: string, context?: string) => void,
  enabled: boolean = true
): void {
  const { status, recoveryRequested } = useSpotifyPlayerStore()
  const attemptRef = useRef(0)
  const inFlightRef = useRef(false)
  // When the player last left 'ready' (or the page loaded without one)
  const notReadySinceRef = useRef<number | null>(null)
  // Bumped to re-arm the timer when an attempt leaves the status unchanged
  // (the effect would otherwise not run again).
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (status === 'ready') {
      attemptRef.current = 0
      notReadySinceRef.current = null
      return
    }
    notReadySinceRef.current ??= Date.now()

    const threshold = STUCK_THRESHOLD_MS[status]
    if (!enabled || threshold === undefined) {
      return
    }

    // A confirmed lost device can't come back by itself: act right away on
    // the first attempt. Later attempts still back off.
    const lostDevice = recoveryRequested && attemptRef.current === 0
    const delay = lostDevice
      ? 0
      : threshold * Math.min(2 ** attemptRef.current, MAX_BACKOFF_MULTIPLIER)
    const timer = setTimeout(() => {
      if (inFlightRef.current) return
      if (
        lostDevice &&
        tryPageReload(
          addLog,
          `Player lost its Spotify device — reloading the page to reconnect (tab ${describeTabVisibility()})`
        )
      ) {
        return
      }
      inFlightRef.current = true
      attemptRef.current++
      addLog(
        'WARN',
        delay === 0
          ? `Player lost its Spotify device — recreating it now (tab ${describeTabVisibility()})`
          : `Player has been '${status}' for ${Math.round(delay / 1000)}s — recreating it (attempt ${attemptRef.current}, tab ${describeTabVisibility()})`,
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

  // Escalation: reload the page when in-place rebuilds have not worked. Runs
  // on its own timer so that a rebuild still in progress cannot delay it.
  useEffect(() => {
    const since = notReadySinceRef.current
    if (!enabled || status === 'ready' || since === null) return

    const timer = setTimeout(
      () => {
        if (spotifyPlayerStore.getState().status === 'ready') return
        tryPageReload(
          addLog,
          `Player has not been 'ready' for ${Math.round((Date.now() - since) / 1000)}s after ${attemptRef.current} rebuild attempt${attemptRef.current === 1 ? '' : 's'} — reloading the page (tab ${describeTabVisibility()})`
        )
      },
      Math.max(0, since + PAGE_RELOAD_AFTER_MS - Date.now())
    )
    return () => clearTimeout(timer)
  }, [status, enabled, addLog])
}
