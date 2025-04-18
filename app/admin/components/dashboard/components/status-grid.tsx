'use client'

import { StatusIndicator } from './status-indicator'
import { HealthStatus } from '../types'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

interface StatusGridProps {
  healthStatus: HealthStatus
  playbackState: SpotifyPlaybackState | null
  isReady: boolean
  fixedPlaylistIsInitialFetchComplete: boolean
}

export function StatusGrid({
  healthStatus,
  playbackState,
  isReady,
  fixedPlaylistIsInitialFetchComplete
}: StatusGridProps): JSX.Element {
  return (
    <div className='grid grid-cols-2 gap-4'>
      <StatusIndicator
        title='Device Health'
        status={healthStatus.device}
        colorMap={{
          healthy: 'bg-green-500',
          unresponsive: 'bg-yellow-500',
          disconnected: 'bg-red-500',
          unknown: 'bg-gray-500',
          error: 'bg-red-500'
        }}
        label={
          healthStatus.device.charAt(0).toUpperCase() +
          healthStatus.device.slice(1)
        }
      />

      <StatusIndicator
        title='Playback State'
        status={
          playbackState?.is_playing
            ? 'playing'
            : playbackState?.item
              ? 'paused'
              : 'stopped'
        }
        colorMap={{
          playing: 'bg-green-500',
          paused: 'bg-yellow-500',
          stopped: 'bg-red-500'
        }}
        label={
          playbackState?.is_playing
            ? 'Playing'
            : playbackState?.item
              ? 'Paused'
              : 'Stopped'
        }
        subtitle={
          playbackState?.item?.name ? `- ${playbackState.item.name}` : undefined
        }
      />

      <StatusIndicator
        title='Token Status'
        status={healthStatus.token}
        colorMap={{
          valid: 'bg-green-500',
          expired: 'bg-red-500',
          error: 'bg-red-500',
          unknown: 'bg-gray-500'
        }}
        label={
          healthStatus.token.charAt(0).toUpperCase() +
          healthStatus.token.slice(1)
        }
        subtitle={
          healthStatus.tokenExpiringSoon ? '(Expiring Soon)' : undefined
        }
      />

      <StatusIndicator
        title='Connection'
        status={isReady ? (navigator.onLine ? 'good' : 'poor') : 'unknown'}
        colorMap={{
          good: 'bg-green-500',
          poor: 'bg-red-500',
          unknown: 'bg-gray-500'
        }}
        label={isReady ? (navigator.onLine ? 'Good' : 'Poor') : 'Unknown'}
      />

      <StatusIndicator
        title='Fixed Playlist'
        status={fixedPlaylistIsInitialFetchComplete ? 'found' : 'not_found'}
        colorMap={{
          found: 'bg-green-500',
          not_found: 'bg-red-500'
        }}
        label={fixedPlaylistIsInitialFetchComplete ? 'Found' : 'Not Found'}
      />
    </div>
  )
}
