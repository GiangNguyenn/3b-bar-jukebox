'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

interface PlaybackControlsProps {
  playbackState: SpotifyPlaybackState | null
  canControlPlayback: boolean
  isLoading: boolean
  loadingAction: 'playPause' | null
  onPlayPause: () => void
}

export function PlaybackControls({
  playbackState,
  canControlPlayback,
  isLoading,
  loadingAction,
  onPlayPause
}: PlaybackControlsProps): JSX.Element {
  const isPlaying = playbackState?.is_playing ?? false

  return (
    <div className='flex items-center justify-center'>
      <button
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
          canControlPlayback && !isLoading
            ? 'hover:bg-muted active:scale-95'
            : 'cursor-not-allowed opacity-50'
        )}
        onClick={onPlayPause}
        disabled={!canControlPlayback || isLoading}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        <Image
          src={isPlaying ? '/pause.svg' : '/play.svg'}
          alt={isPlaying ? 'Pause' : 'Play'}
          width={20}
          height={20}
          className={cn(
            'h-5 w-5',
            loadingAction === 'playPause' && 'animate-spin'
          )}
        />
      </button>
    </div>
  )
} 