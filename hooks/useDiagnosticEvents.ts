'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSpotifyPlayerStore } from './useSpotifyPlayer'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import type {
  DiagnosticEvent,
  DiagnosticEventType
} from '@/shared/types/health'

const MAX_EVENTS = 30
const EVENT_BUFFER_TIME_MS = 5 * 60 * 1000 // 5 minutes

export function useDiagnosticEvents(): DiagnosticEvent[] {
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const eventsRef = useRef<DiagnosticEvent[]>([])
  const lastStatusRef = useRef<string | null>(null)
  const lastPlaybackStateRef = useRef<string | null>(null)
  const { logs } = useConsoleLogsContext()
  const { status, lastStatusChange, lastError, playbackState } =
    useSpotifyPlayerStore()

  // Helper to add event
  const addEvent = useCallback(
    (
      type: DiagnosticEventType,
      message: string,
      severity: 'info' | 'warning' | 'error' = 'info',
      details?: Record<string, unknown>
    ): void => {
      const newEvent: DiagnosticEvent = {
        type,
        timestamp: Date.now(),
        message,
        severity,
        details
      }

      setEvents((prev) => {
        const updated = [newEvent, ...prev]
        // Keep only events within the time window and max count
        const now = Date.now()
        const filtered = updated
          .filter((e) => now - e.timestamp < EVENT_BUFFER_TIME_MS)
          .slice(0, MAX_EVENTS)
        eventsRef.current = filtered
        return filtered
      })
    },
    []
  )

  // Track status changes
  useEffect(() => {
    const currentStatus = status
    const lastStatus = lastStatusRef.current

    if (lastStatus !== null && lastStatus !== currentStatus) {
      addEvent(
        'status_change',
        `Player status changed: ${lastStatus} → ${currentStatus}`,
        currentStatus === 'error' ? 'error' : 'info',
        {
          from: lastStatus,
          to: currentStatus,
          timestamp: lastStatusChange
        }
      )
    }

    lastStatusRef.current = currentStatus
  }, [status, lastStatusChange, addEvent])

  // Track errors
  useEffect(() => {
    if (lastError) {
      addEvent('error', lastError, 'error', {
        status,
        timestamp: lastStatusChange
      })
    }
  }, [lastError, status, lastStatusChange, addEvent])

  // Track playback state changes
  useEffect(() => {
    if (!playbackState) {
      if (lastPlaybackStateRef.current !== null) {
        addEvent(
          'playback_change',
          'Playback state became null (device inactive)',
          'warning'
        )
      }
      lastPlaybackStateRef.current = null
      return
    }

    const currentState = playbackState.is_playing
      ? 'playing'
      : playbackState.item
        ? 'paused'
        : 'stopped'
    const lastState = lastPlaybackStateRef.current

    if (lastState !== null && lastState !== currentState) {
      const trackName = playbackState.item?.name ?? 'Unknown'
      addEvent(
        'playback_change',
        `Playback state: ${lastState} → ${currentState} (${trackName})`,
        'info',
        {
          from: lastState,
          to: currentState,
          trackId: playbackState.item?.id,
          trackName
        }
      )
    }

    lastPlaybackStateRef.current = currentState
  }, [playbackState, addEvent])

  // Track recent error/warning logs
  useEffect(() => {
    // Get the most recent ERROR/WARN logs that haven't been tracked yet
    const recentLogs = logs
      .filter(
        (log) =>
          (log.level === 'ERROR' || log.level === 'WARN') &&
          log.context &&
          [
            'PlaybackHealth',
            'PlaybackRecovery',
            'DeviceHealth',
            'TokenHealth',
            'SpotifyPlayer'
          ].includes(log.context)
      )
      .slice(0, 5) // Only process most recent 5

    recentLogs.forEach((log) => {
      const eventExists = eventsRef.current.some(
        (e) =>
          e.message === log.message &&
          Math.abs(e.timestamp - new Date(log.timestamp).getTime()) < 1000
      )

      if (!eventExists) {
        addEvent(
          'error',
          log.message,
          log.level === 'ERROR' ? 'error' : 'warning',
          {
            context: log.context,
            error: log.error?.message
          }
        )
      }
    })
  }, [logs, addEvent])

  // Cleanup old events periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setEvents((prev) => {
        const filtered = prev.filter(
          (e) => now - e.timestamp < EVENT_BUFFER_TIME_MS
        )
        eventsRef.current = filtered
        return filtered
      })
    }, 60000) // Clean up every minute

    return () => clearInterval(interval)
  }, [])

  return events
}
