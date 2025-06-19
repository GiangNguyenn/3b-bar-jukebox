import { TrackItem } from '@/shared/types'
import React from 'react'
import QueueItem from '@/components/Playlist/QueueItem'
import NowPlaying from '@/components/Playlist/NowPlaying'
import useNowPlayingTrack from '@/hooks/useNowPlayingTrack'
import { filterUpcomingTracks } from '@/lib/utils'

interface IPlaylistProps {
  tracks: TrackItem[]
}

const Playlist: React.FC<IPlaylistProps> = ({ tracks }): JSX.Element => {
  const { data: playbackState } = useNowPlayingTrack()
  const currentTrackId = playbackState?.item?.id ?? null

  const upcomingTracks = filterUpcomingTracks(tracks, currentTrackId) ?? []
  const tracksToShow = currentTrackId ? upcomingTracks : tracks

  if (!tracksToShow?.length) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full overflow-hidden rounded-lg bg-primary-100 shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <div className='flex w-full flex-col'>
            <NowPlaying nowPlaying={playbackState ?? undefined} />
            <div className='flex flex-col p-5'>
              <div className='text-center text-gray-500'>
                No tracks in the playlist yet
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='w-full'>
      <div className='mx-auto flex w-full overflow-hidden rounded-lg bg-primary-100 shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'>
        <div className='flex w-full flex-col'>
          <NowPlaying nowPlaying={playbackState ?? undefined} />

          <div className='flex flex-col p-5'>
            <div className='mb-2 flex items-center justify-between border-b pb-1'>
              <span className='text-base font-semibold uppercase text-gray-700'>
                UPCOMING TRACKS
              </span>
            </div>
            {tracksToShow.map((track) => (
              <QueueItem key={track.track.id} track={track} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Playlist
