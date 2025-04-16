'use client'

interface LastSuggestedTrackProps {
  trackInfo?: {
    name: string
    artist: string
    album: string
    uri: string
  }
}

export function LastSuggestedTrack({
  trackInfo
}: LastSuggestedTrackProps): JSX.Element {
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
