'use client'

import { StatusIndicator } from './components/status-indicator'
import { PlaybackProgress } from './components/playback-progress'
import { HealthStatus } from '@/shared/types'

interface HealthStatusSectionProps {
  healthStatus: HealthStatus
  playbackInfo: {
    currentTrack?: string
    progress?: number
    duration_ms?: number
  } | null
  formatTime: (ms: number) => string
  isReady: boolean
}

const playerColorMap: Record<string, string> = {
  ready: 'bg-green-500',
  initializing: 'bg-yellow-500'
}

const deviceColorMap: Record<string, string> = {
  healthy: 'bg-green-500',
  unresponsive: 'bg-yellow-500',
  disconnected: 'bg-red-500',
  unknown: 'bg-gray-500'
}

const playbackColorMap: Record<string, string> = {
  playing: 'bg-green-500',
  paused: 'bg-yellow-500',
  error: 'bg-red-500',
  stopped: 'bg-gray-500'
}

const tokenColorMap: Record<string, string> = {
  valid: 'bg-green-500',
  error: 'bg-red-500',
  unknown: 'bg-gray-500'
}

const connectionColorMap: Record<string, string> = {
  good: 'bg-green-500',
  unstable: 'bg-yellow-500',
  poor: 'bg-red-500',
  unknown: 'bg-gray-500'
}

const playlistColorMap: Record<string, string> = {
  found: 'bg-green-500',
  not_found: 'bg-red-500',
  error: 'bg-red-500',
  unknown: 'bg-gray-500'
}

export function HealthStatusSection({
  healthStatus,
  playbackInfo,
  formatTime,
  isReady
}: HealthStatusSectionProps): JSX.Element {
  return (
    <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
      <div className='space-y-2'>
        <StatusIndicator
          title="Player Status"
          status={isReady ? 'ready' : 'initializing'}
          colorMap={playerColorMap}
          label={isReady ? 'Player Ready' : 'Player Initializing...'}
        />

        <StatusIndicator
          title="Device Status"
          status={healthStatus.device}
          colorMap={deviceColorMap}
          label={
            healthStatus.device === 'healthy'
              ? 'Device Connected'
              : healthStatus.device === 'unresponsive'
                ? 'Device Unresponsive'
                : 'Device Status Unknown'
          }
        />

        <StatusIndicator
          title="Playback Status"
          status={healthStatus.playback}
          colorMap={playbackColorMap}
          label={
            healthStatus.playback === 'playing'
              ? 'Playback Active'
              : healthStatus.playback === 'paused'
                ? 'Playback Paused'
                : healthStatus.playback === 'error'
                  ? 'Playback Error'
                  : 'Playback Stopped'
          }
          subtitle={playbackInfo?.currentTrack}
        />

        {playbackInfo?.duration_ms && playbackInfo?.progress && (
          <div className='mt-2'>
            <PlaybackProgress
              progress={playbackInfo.progress}
              duration_ms={playbackInfo.duration_ms}
              formatTime={formatTime}
            />
          </div>
        )}

        <StatusIndicator
          title="Token Status"
          status={healthStatus.token}
          colorMap={tokenColorMap}
          label={
            healthStatus.token === 'valid' && !healthStatus.tokenExpiringSoon
              ? 'Token Valid'
              : healthStatus.token === 'valid' && healthStatus.tokenExpiringSoon
                ? 'Token Expiring Soon'
                : healthStatus.token === 'error'
                  ? 'Token Error'
                  : 'Token Status Unknown'
          }
        />

        <StatusIndicator
          title="Connection Status"
          status={healthStatus.connection}
          colorMap={connectionColorMap}
          label={
            healthStatus.connection === 'good'
              ? 'Connection Good'
              : healthStatus.connection === 'unstable'
                ? 'Connection Unstable'
                : healthStatus.connection === 'poor'
                  ? 'Connection Poor'
                  : 'Connection Status Unknown'
          }
        />

        <StatusIndicator
          title="Playlist Status"
          status={healthStatus.fixedPlaylist}
          colorMap={playlistColorMap}
          label={
            healthStatus.fixedPlaylist === 'found'
              ? 'Playlist Found'
              : healthStatus.fixedPlaylist === 'not_found'
                ? 'Fixed Playlist Not Found'
                : healthStatus.fixedPlaylist === 'error'
                  ? 'Fixed Playlist Error'
                  : 'Fixed Playlist Status Unknown'
          }
        />
      </div>
    </div>
  )
} 