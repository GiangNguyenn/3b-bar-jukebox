import { JukeboxQueueItem } from '@/shared/types/queue'
import React from 'react'
import Image from 'next/image'
import { useTrackArtwork } from '@/hooks/useTrackArtwork'

interface IQueueItemProps {
  track: JukeboxQueueItem
  votes: number
  queueId: string
  onVote: (queueId: string, direction: 'up' | 'down') => void
  isPlaying?: boolean
  textColor?: string
  secondaryColor?: string
  accentColor2?: string
  accentColor3?: string
}

const QueueItem: React.FC<IQueueItemProps> = ({
  track,
  votes,
  queueId,
  onVote,
  isPlaying = false,
  textColor = '#000000',
  secondaryColor = '#6b7280',
  accentColor2 = '#6b7280',
  accentColor3 = '#f3f4f6'
}): JSX.Element | null => {
  const { url: artworkUrl, isLoading: isArtworkLoading } = useTrackArtwork(
    track.tracks?.spotify_track_id ?? ''
  )

  if (!track.tracks) return null

  return (
    <div
      className={`flex items-center space-x-4 py-2 ${isPlaying ? 'border-l-4 border-green-500 bg-green-100' : ''}`}
      data-track-id={track.tracks.id}
    >
      <div className='relative h-12 w-12 flex-shrink-0'>
        {artworkUrl ? (
          <Image
            src={artworkUrl}
            alt={track.tracks.album}
            fill
            sizes='48px'
            className='rounded object-cover'
          />
        ) : (
          <div className='flex h-12 w-12 items-center justify-center rounded bg-gray-200'>
            {isArtworkLoading ? (
              <div className='h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600'></div>
            ) : (
              <svg
                className='h-6 w-6 text-gray-400'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
                />
              </svg>
            )}
          </div>
        )}
      </div>
      <div className='min-w-0 flex-1'>
        <p
          className='truncate text-sm font-medium'
          style={{ color: textColor }}
        >
          {track.tracks.name}
          {isPlaying && (
            <span className='ml-2 text-xs font-bold text-green-600'>
              (Now Playing)
            </span>
          )}
        </p>
        <p className='truncate text-sm' style={{ color: secondaryColor }}>
          {track.tracks.artist}
        </p>
      </div>
      <div className='flex items-center space-x-2'>
        <button
          className='rounded p-1'
          style={{
            color: accentColor2,
            backgroundColor: 'transparent',
            transition: 'background-color 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = accentColor3
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
          onClick={() => onVote(queueId, 'up')}
        >
          {/* Placeholder for upvote icon */}
          <svg
            className='h-5 w-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M5 15l7-7 7 7'
            />
          </svg>
        </button>
        <span className='text-sm font-semibold text-gray-700'>{votes}</span>
        <button
          className='rounded p-1'
          style={{
            color: accentColor2,
            backgroundColor: 'transparent',
            transition: 'background-color 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = accentColor3
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
          onClick={() => onVote(queueId, 'down')}
        >
          {/* Placeholder for downvote icon */}
          <svg
            className='h-5 w-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default QueueItem
