'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { ErrorMessage } from '@/components/ui/error-message'

export function SpotifyPlayer(): JSX.Element {
  // State
  const [error, setError] = useState<string | null>(null)

  // Hooks
  const {
    deviceId,
    isReady,
    playbackState: _playbackState
  } = useSpotifyPlayerStore()

  // Refs
  const localPlaylistRefreshInterval = useRef<NodeJS.Timeout | null>(null)

  // Effects
  useEffect(() => {
    const interval = setInterval(() => {
      // Update playback state
      if (isReady && deviceId) {
        // Dispatch custom event for playback updates
        const event = new CustomEvent('playbackUpdate', {
          detail: {
            deviceId,
            isReady,
            playbackState: _playbackState
          }
        })
        window.dispatchEvent(event)
      }
    }, 1000)

    return (): void => {
      clearInterval(interval)
    }
  }, [isReady, deviceId, _playbackState])

  // Cleanup on unmount
  useEffect(() => {
    const interval = localPlaylistRefreshInterval.current
    return (): void => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [])

  // Event handlers
  const handlePlaybackUpdate = useCallback((event: CustomEvent): void => {
    // Handle playback updates
    console.log('Playback update:', event.detail)
  }, [])

  const handleError = useCallback((event: Event): void => {
    const errorEvent = event as ErrorEvent
    setError(errorEvent.message)
  }, [])

  // Add event listeners
  useEffect(() => {
    window.addEventListener(
      'playbackUpdate',
      handlePlaybackUpdate as EventListener
    )
    window.addEventListener('error', handleError)

    return (): void => {
      window.removeEventListener(
        'playbackUpdate',
        handlePlaybackUpdate as EventListener
      )
      window.removeEventListener('error', handleError)
    }
  }, [handlePlaybackUpdate, handleError])

  if (error) {
    return (
      <ErrorMessage
        message={`Error: ${error}`}
        onDismiss={() => setError(null)}
      />
    )
  }

  return (
    <div className='text-white'>
      <div className='flex items-center justify-between rounded-lg bg-gray-800 p-4'>
        <div className='flex items-center space-x-4'>
          <div className='flex h-12 w-12 items-center justify-center rounded-full bg-green-500'>
            <span className='text-lg font-bold'>S</span>
          </div>
          <div>
            <h3 className='font-semibold'>Spotify Player</h3>
            <p className='text-sm text-gray-400'>
              {isReady ? 'Connected' : 'Connecting...'}
            </p>
          </div>
        </div>
        <div className='text-right'>
          <p className='text-sm text-gray-400'>Device ID</p>
          <p className='font-mono text-xs'>{deviceId ?? 'Not connected'}</p>
        </div>
      </div>
    </div>
  )
}
