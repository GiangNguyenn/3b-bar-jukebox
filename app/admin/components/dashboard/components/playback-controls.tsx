'use client'

import { SkipBack, SkipForward } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

interface PlaybackControlsProps {
  playbackState: SpotifyPlaybackState | null
  canControlPlayback: boolean
  isLoading: boolean
  loadingAction: 'playPause' | 'next' | 'previous' | null
  onPlayPause: () => void
  onSkipNext: () => void
  onSkipPrevious: () => void
}

export function PlaybackControls({
  playbackState,
  canControlPlayback,
  isLoading,
  loadingAction,
  onPlayPause,
  onSkipNext,
  onSkipPrevious
}: PlaybackControlsProps): JSX.Element {
  const isPlaying = playbackState?.is_playing ?? false

  return (
    <div className='flex items-center justify-center gap-4'>
      <button
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          canControlPlayback && !isLoading
            ? 'hover:bg-muted active:scale-95'
            : 'cursor-not-allowed opacity-50'
        )}
        onClick={onSkipPrevious}
        disabled={!canControlPlayback || isLoading}
        aria-label='Previous track'
      >
        <SkipBack
          className={cn(
            'h-4 w-4',
            loadingAction === 'previous' && 'animate-spin'
          )}
        />
      </button>
      <button
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
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
          width={16}
          height={16}
          className={cn(
            'h-4 w-4',
            loadingAction === 'playPause' && 'animate-spin'
          )}
        />
      </button>
      <button
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          canControlPlayback && !isLoading
            ? 'hover:bg-muted active:scale-95'
            : 'cursor-not-allowed opacity-50'
        )}
        onClick={onSkipNext}
        disabled={!canControlPlayback || isLoading}
        aria-label='Next track'
      >
        <SkipForward
          className={cn('h-4 w-4', loadingAction === 'next' && 'animate-spin')}
        />
      </button>
    </div>
  )
}
