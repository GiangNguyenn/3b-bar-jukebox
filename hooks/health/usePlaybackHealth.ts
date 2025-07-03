import { useState, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { usePlaybackIntentStore } from '../usePlaybackIntent'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'

type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'unknown' | 'stalled'

export function usePlaybackHealth(): PlaybackStatus {
  const [playbackStatus, setPlaybackStatus] =
    useState<PlaybackStatus>('unknown')
  const { addLog } = useConsoleLogsContext()
  const { userIntent } = usePlaybackIntentStore()
  const lastCheckRef = useRef<{
    progress: number | null
    uri: string | null
  }>({ progress: null, uri: null })

  const userIntentRef = useRef(userIntent)

  useEffect(() => {
    userIntentRef.current = userIntent
  }, [userIntent])

  useEffect(() => {
    const intervalId = setInterval(async () => {
      const intent = userIntentRef.current

      if (intent !== 'playing') {
        setPlaybackStatus(intent === 'paused' ? 'paused' : 'stopped')
        lastCheckRef.current = { progress: null, uri: null }
        return
      }

      try {
        const currentPlaybackState = await sendApiRequest<SpotifyPlaybackState>(
          {
            path: 'me/player',
            method: 'GET'
          }
        )

        if (!currentPlaybackState || !currentPlaybackState.item) {
          setPlaybackStatus('stopped')
          lastCheckRef.current = { progress: null, uri: null }
          return
        }

        const lastCheck = lastCheckRef.current
        const currentProgress = currentPlaybackState.progress_ms ?? null
        const currentUri = currentPlaybackState.item.uri

        if (lastCheck.uri === null || lastCheck.uri !== currentUri) {
          setPlaybackStatus('playing')
        } else {
          if (
            currentProgress !== null &&
            currentProgress === lastCheck.progress
          ) {
            setPlaybackStatus('stalled')
            addLog(
              'ERROR',
              `Playback stalled. No progress in last 15s via API. Intent: ${intent}, Last Progress: ${lastCheck.progress}, Current Progress: ${currentProgress}.`,
              'PlaybackHealth'
            )
          } else {
            setPlaybackStatus('playing')
          }
        }

        lastCheckRef.current = { progress: currentProgress, uri: currentUri }
      } catch (error) {
        addLog(
          'ERROR',
          'Failed to fetch playback state for health check.',
          'PlaybackHealth',
          error instanceof Error ? error : undefined
        )
      }
    }, 15000) // Check every 15 seconds

    return () => clearInterval(intervalId)
  }, [addLog])

  return playbackStatus
}
