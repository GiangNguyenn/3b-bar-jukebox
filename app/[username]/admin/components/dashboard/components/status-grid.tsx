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
    <div className="grid grid-cols-2 gap-4">
      <StatusIndicator
        title="Player Status"
        status={isReady ? 'ready' : 'initializing'}
        colorMap={{
          ready: 'bg-green-500',
          initializing: 'bg-yellow-500'
        }}
        label={isReady ? 'Ready' : 'Initializing...'}
      />

      <StatusIndicator
        title="Device Health"
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
        title="Playback State"
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
        title="Token Status"
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
        title="Connection"
        status={healthStatus.connection}
        colorMap={{
          good: 'bg-green-500',
          unstable: 'bg-yellow-500',
          poor: 'bg-red-500',
          error: 'bg-red-500',
          unknown: 'bg-gray-500'
        }}
        label={
          healthStatus.connection.charAt(0).toUpperCase() +
          healthStatus.connection.slice(1)
        }
      />

      <StatusIndicator
        title="Fixed Playlist"
        status={healthStatus.fixedPlaylist}
        colorMap={{
          found: 'bg-green-500',
          not_found: 'bg-red-500',
          error: 'bg-red-500',
          unknown: 'bg-gray-500'
        }}
        label={
          healthStatus.fixedPlaylist === 'found'
            ? 'Found'
            : healthStatus.fixedPlaylist === 'not_found'
              ? 'Not Found'
              : healthStatus.fixedPlaylist === 'error'
                ? 'Error'
                : 'Unknown'
        }
      />
    </div>
  )
} 