'use client'

import { useEffect, useRef } from 'react'
import { TrackItem, SpotifyPlaybackState } from '@/shared/types/spotify'
import QueueItem from './QueueItem'
import NowPlaying from './NowPlaying'

interface PlaylistProps {
  tracks: TrackItem[]
  optimisticTracks?: TrackItem[]
  currentlyPlaying?: SpotifyPlaybackState | null
}

export default function Playlist({
  tracks,
  optimisticTracks,
  currentlyPlaying
}: PlaylistProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const currentTrackIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const currentTrack = container.querySelector(
      '[data-track-id="' + currentTrackIdRef.current + '"]'
    )
    if (currentTrack) {
      currentTrack.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [tracks])

  useEffect(() => {
    if (optimisticTracks && optimisticTracks.length > 0) {
      currentTrackIdRef.current =
        optimisticTracks[optimisticTracks.length - 1].track.id
    }
  }, [optimisticTracks])

  const tracksToShow = tracks.filter((track) => {
    if (!currentlyPlaying) return true
    return track.track.id !== currentlyPlaying?.item?.id
  })

  return (
    <div className='w-full'>
      <div className='mx-auto flex w-full overflow-hidden rounded-lg bg-primary-100 shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'>
        <div className='flex w-full flex-col'>
          <NowPlaying nowPlaying={currentlyPlaying ?? undefined} />
          <div className='flex flex-col p-5'>
            <div className='mb-2 flex items-center justify-between border-b pb-1'>
              <span className='text-base font-semibold uppercase text-gray-700'>
                {!currentlyPlaying ? 'ALL TRACKS' : 'UPCOMING TRACKS'}
              </span>
            </div>
            <div
              ref={containerRef}
              className='flex max-h-[calc(100vh-16rem)] flex-col space-y-2 overflow-y-auto'
            >
              {tracksToShow.map((track, index) => (
                <QueueItem
                  key={`${track.track.id}-${index}-${track.added_at}`}
                  track={track}
                  isPending={
                    optimisticTracks?.some(
                      (t) => t.track.id === track.track.id
                    ) ?? false
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
