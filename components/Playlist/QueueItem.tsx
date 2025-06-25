import { TrackItem } from '@/shared/types/spotify'
import React from 'react'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'

interface IQueueItemProps {
  track: TrackItem
  isPending?: boolean
}

const QueueItem: React.FC<IQueueItemProps> = ({
  track,
  isPending = false
}): JSX.Element => {
  return (
    <div
      className={`flex items-center space-x-4 py-2 transition-opacity duration-200 ${
        isPending ? 'opacity-70' : 'opacity-100'
      }`}
      data-track-id={track.track.id}
    >
      <div className='relative h-12 w-12 flex-shrink-0'>
        <Image
          src={track.track.album.images[0]?.url ?? '/default-album.png'}
          alt={track.track.album.name}
          fill
          sizes='48px'
          className='rounded object-cover'
        />
        {isPending && (
          <div className='absolute inset-0 flex items-center justify-center rounded bg-black/20'>
            <Loader2 className='text-white h-4 w-4 animate-spin' />
          </div>
        )}
      </div>
      <div className='min-w-0 flex-1'>
        <p
          className={`truncate text-sm font-medium ${
            isPending ? 'text-gray-600' : 'text-gray-900'
          }`}
        >
          {track.track.name}
          {isPending && (
            <span className='ml-2 text-xs text-gray-500'>Adding...</span>
          )}
        </p>
        <p
          className={`truncate text-sm ${
            isPending ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          {track.track.artists.map((artist) => artist.name).join(', ')}
        </p>
      </div>
    </div>
  )
}

export default QueueItem
