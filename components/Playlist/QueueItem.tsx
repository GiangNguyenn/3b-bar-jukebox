import { TrackItem } from '@/shared/types'
import React, { FC } from 'react'
// Using img instead of next/image for Spotify album art to avoid 402 errors from Spotify's CDN

interface IQueueItemProps {
  track: TrackItem
}

const QueueItem: FC<IQueueItemProps> = ({ track }) => {
  const {
    track: {
      name,
      album: { images },
      artists
    }
  } = track

  return (
    <div className='flex cursor-pointer border-b px-2 py-3 hover:shadow-md'>
      <img
        className='rounded-lg'
        alt='Album cover'
        src={images[0].url}
        width={40}
        height={40}
        style={{ objectFit: 'cover' }}
      />
      <div className='flex w-full flex-col px-2'>
        <span className='pt-1 text-sm font-semibold capitalize text-secondary-500'>
          {name}
        </span>
        <span className='text-xs font-medium uppercase text-gray-500'>
          -{artists.map((artist) => artist.name).join(', ')}
        </span>
      </div>
    </div>
  )
}
export default QueueItem
