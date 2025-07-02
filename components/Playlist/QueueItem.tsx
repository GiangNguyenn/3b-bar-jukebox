import { TrackItem } from '@/shared/types/spotify'
import React from 'react'
import Image from 'next/image'

interface IQueueItemProps {
  track: TrackItem
}

const QueueItem: React.FC<IQueueItemProps> = ({ track }): JSX.Element => {
  return (
    <div
      className='flex items-center space-x-4 py-2'
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
      </div>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium text-gray-900'>
          {track.track.name}
        </p>
        <p className='truncate text-sm text-gray-500'>
          {track.track.artists.map((artist) => artist.name).join(', ')}
        </p>
      </div>
    </div>
  )
}

export default QueueItem
