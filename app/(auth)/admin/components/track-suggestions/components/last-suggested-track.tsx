'use client'

import { type LastSuggestedTrackInfo } from '@/shared/types/trackSuggestions'

interface LastSuggestedTrackProps {
  trackInfo?: LastSuggestedTrackInfo
}

export function LastSuggestedTrack({
  trackInfo
}: LastSuggestedTrackProps): JSX.Element {
  const formatDuration = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-medium'>Last Suggested Track</h3>
      <div className='rounded-lg border bg-muted p-4'>
        {trackInfo ? (
          <div className='space-y-2'>
            <p className='text-sm text-muted-foreground'>
              <span className='font-medium'>Track:</span> {trackInfo.name}
            </p>
            <p className='text-sm text-muted-foreground'>
              <span className='font-medium'>Artist:</span> {trackInfo.artist}
            </p>
            <p className='text-sm text-muted-foreground'>
              <span className='font-medium'>Album:</span> {trackInfo.album}
            </p>
            <p className='text-sm text-muted-foreground'>
              <span className='font-medium'>Genres:</span>{' '}
              {trackInfo.genres.length > 0
                ? trackInfo.genres.join(', ')
                : 'No genres available'}
            </p>
            <p className='text-sm text-muted-foreground'>
              <span className='font-medium'>Popularity:</span>{' '}
              {trackInfo.popularity}/100
            </p>
            <p className='text-sm text-muted-foreground'>
              <span className='font-medium'>Duration:</span>{' '}
              {formatDuration(trackInfo.duration_ms)}
            </p>
            {trackInfo.preview_url && (
              <p className='text-sm text-muted-foreground'>
                <span className='font-medium'>Preview:</span>{' '}
                <a
                  href={trackInfo.preview_url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-primary hover:underline'
                >
                  Listen
                </a>
              </p>
            )}
            <p className='text-sm text-muted-foreground'>
              <span className='font-medium'>URI:</span>{' '}
              <span className='font-mono text-xs'>{trackInfo.uri}</span>
            </p>
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>
            No track has been suggested yet
          </p>
        )}
      </div>
    </div>
  )
}
