'use client'

import { RefreshCw, Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

interface PlaybackControlsProps {
  isLoading: boolean
  tokenExpiryTime: number | null
  fixedPlaylistIsInitialFetchComplete: boolean
  playbackState: SpotifyPlaybackState | null
  onPlaybackControl: (
    action: 'play' | 'pause' | 'next' | 'previous'
  ) => Promise<void>
  onTokenRefresh: () => Promise<void>
  onPlaylistRefresh: () => Promise<void>
}

export function PlaybackControls({
  isLoading,
  tokenExpiryTime,
  fixedPlaylistIsInitialFetchComplete,
  playbackState,
  onPlaybackControl,
  onTokenRefresh,
  onPlaylistRefresh
}: PlaybackControlsProps): JSX.Element {
  const isPlaying = playbackState?.is_playing ?? false
  const canControlPlayback = playbackState !== null && !isLoading

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-2'>
          <button
            type='button'
            className='rounded-md border border-gray-700 bg-gray-800 p-2 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800'
            onClick={() => void onPlaybackControl('previous')}
            disabled={!canControlPlayback}
          >
            <SkipBack className='h-4 w-4' />
          </button>
          <button
            type='button'
            className='rounded-md border border-gray-700 bg-gray-800 p-2 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800'
            onClick={() => void onPlaybackControl(isPlaying ? 'pause' : 'play')}
            disabled={!canControlPlayback}
          >
            {isPlaying ? (
              <Pause className='h-4 w-4' />
            ) : (
              <Play className='h-4 w-4' />
            )}
          </button>
          <button
            type='button'
            className='rounded-md border border-gray-700 bg-gray-800 p-2 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800'
            onClick={() => void onPlaybackControl('next')}
            disabled={!canControlPlayback}
          >
            <SkipForward className='h-4 w-4' />
          </button>
        </div>

        <div className='flex items-center space-x-2'>
          <button
            type='button'
            className='rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800'
            onClick={() => void onTokenRefresh()}
            disabled={isLoading || !tokenExpiryTime}
          >
            <RefreshCw
              className={cn(
                'mr-2 inline-block h-4 w-4',
                isLoading && 'animate-spin'
              )}
            />
            Refresh Token
          </button>
          <button
            type='button'
            className='rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800'
            onClick={() => void onPlaylistRefresh()}
            disabled={isLoading || !fixedPlaylistIsInitialFetchComplete}
          >
            <RefreshCw
              className={cn(
                'mr-2 inline-block h-4 w-4',
                isLoading && 'animate-spin'
              )}
            />
            Refresh Playlist
          </button>
        </div>
      </div>

      {playbackState?.item && (
        <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
          <div className='flex items-center justify-between'>
            <div>
              <h3 className='text-sm font-medium text-gray-400'>Now Playing</h3>
              <p className='text-sm text-gray-300'>{playbackState.item.name}</p>
              <p className='text-xs text-gray-400'>
                {playbackState.item.artists
                  .map((artist) => artist.name)
                  .join(', ')}
              </p>
            </div>
            {playbackState.item.album.images[0] && (
              <img
                src={playbackState.item.album.images[0].url}
                alt={playbackState.item.album.name}
                className='h-12 w-12 rounded'
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
