'use client'

import { useEffect, useRef } from 'react'
import { useSpotifyPlayerStore } from './useSpotifyPlayer'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { sendApiRequest } from '@/shared/api'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

const ENFORCEMENT_INTERVAL_MS = 5000 // Check every 5 seconds

export function usePlaybackEnforcer(enabled: boolean = true) {
  const { deviceId, status } = useSpotifyPlayerStore()
  const { addLog } = useConsoleLogsContext()
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Only enforce if enabled, we have a device ID, and player is ready
    if (!enabled || !deviceId || status !== 'ready') {
      return
    }

    const checkAndEnforcePlayback = async () => {
      try {
        // Get current playback state
        const playbackState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        // If no playback is active, nothing to enforce
        if (!playbackState || !playbackState.device) {
          return
        }

        // Check if playback is on another device
        if (playbackState.device.id !== deviceId) {
          const deviceName = playbackState.device.name
          const isPlaying = playbackState.is_playing

          addLog(
            'WARN',
            `Detected active session on unauthorized device [${deviceName}]. Transferring playback to Jukebox.`,
            'PlaybackEnforcement'
          )

          // Transfer playback back to Jukebox
          await sendApiRequest({
            path: 'me/player',
            method: 'PUT',
            body: {
              device_ids: [deviceId],
              play: isPlaying // Resume if it was playing, otherwise keep paused
            }
          })

          addLog(
            'INFO',
            `Successfully transferred playback back to Jukebox from [${deviceName}]`,
            'PlaybackEnforcement'
          )
        }
      } catch (error) {
        // Log error but don't spam if it's just a transient network issue
        // Only log if it's not an expected "no active device" 204 response (which comes as empty object usually)
        if (error instanceof Error) {
          // Avoid logging expected errors or too frequent errors
        }
      }
    }

    // Start polling
    intervalRef.current = setInterval(
      checkAndEnforcePlayback,
      ENFORCEMENT_INTERVAL_MS
    )

    // Run immediately once
    void checkAndEnforcePlayback()

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [enabled, deviceId, status, addLog])
}
