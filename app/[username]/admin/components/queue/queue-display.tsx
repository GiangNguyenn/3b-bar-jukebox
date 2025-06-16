'use client'

import { useUserQueue } from '@/hooks/useUserQueue'
import type { UserQueue } from '@/shared/types'

export function QueueDisplay(): JSX.Element {
  const { data: queue } = useUserQueue('')

  if (!queue?.queue) {
    return <div>Loading queue...</div>
  }

  return (
    <div className='space-y-4'>
      <h2 className='text-lg font-semibold'>Queue</h2>
      <div className='space-y-2'>
        {queue.queue.map((track: UserQueue['queue'][number], index: number) => (
          <div
            key={`${track.id}-${index}`}
            className='flex items-center space-x-4'
          >
            <span className='text-sm text-gray-400'>{index + 1}</span>
            <div>
              <p className='text-sm font-medium'>{track.name}</p>
              <p className='text-sm text-gray-400'>
                {track.artists
                  .map((artist: { name: string }) => artist.name)
                  .join(', ')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
