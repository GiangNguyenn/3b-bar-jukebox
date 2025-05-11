'use client'

import { SkipBack, SkipForward } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

interface PlaybackControlsProps {
  playbackState: SpotifyPlaybackState | null
  canControlPlayback: boolean
  onPlayPause: () => void
  onSkipNext: () => void
  onSkipPrevious: () => void
}

export function PlaybackControls({
  playbackState,
  canControlPlayback,
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
          canControlPlayback
            ? 'hover:bg-muted active:scale-95'
            : 'cursor-not-allowed opacity-50'
        )}
        onClick={onSkipPrevious}
        disabled={!canControlPlayback}
        aria-label='Previous track'
      >
        <SkipBack className='h-4 w-4' />
      </button>
      <button
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          canControlPlayback
            ? 'hover:bg-muted active:scale-95'
            : 'cursor-not-allowed opacity-50'
        )}
        onClick={onPlayPause}
        disabled={!canControlPlayback}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        <Image
          src={isPlaying ? '/pause.svg' : '/play.svg'}
          alt={isPlaying ? 'Pause' : 'Play'}
          width={16}
          height={16}
          className='h-4 w-4'
        />
      </button>
      <button
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          canControlPlayback
            ? 'hover:bg-muted active:scale-95'
            : 'cursor-not-allowed opacity-50'
        )}
        onClick={onSkipNext}
        disabled={!canControlPlayback}
        aria-label='Next track'
      >
        <SkipForward className='h-4 w-4' />
      </button>
    </div>
  )
}
