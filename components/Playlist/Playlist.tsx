'use client'

import { TrackItem } from '@/shared/types'
import React, { useEffect, useRef, memo, useMemo } from 'react'
import QueueItem from './QueueItem'
import NowPlaying from './NowPlaying'
import useNowPlayingTrack from '@/hooks/useNowPlayingTrack'
import { filterUpcomingTracks } from '@/lib/utils'
import { useAutoRemoveFinishedTrack } from '@/hooks/useAutoRemoveFinishedTrack'
import { useGetPlaylist } from '@/hooks/useGetPlaylist'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useTrackSuggestionsState } from '@/hooks/useTrackSuggestionsState'

interface IPlaylistProps {
  tracks: TrackItem[]
}

const Playlist: React.FC<IPlaylistProps> = memo(({ tracks }): JSX.Element => {
  const { data: playbackState } = useNowPlayingTrack()
  const currentTrackId = playbackState?.item?.id ?? null
  const previousTrackIdRef = useRef<string | null>(null)
  const { fixedPlaylistId } = useFixedPlaylist()
  const { refetchPlaylist } = useGetPlaylist(fixedPlaylistId ?? '')
  const { songsBetweenRepeats } = useTrackSuggestionsState()

  // Listen for playlist refresh events
  useEffect(() => {
    const handlePlaylistRefresh = (): void => {
      void refetchPlaylist().catch((error) => {
        console.error('[Playlist] Error refreshing playlist:', error)
      })
    }

    window.addEventListener('playlistRefresh', handlePlaylistRefresh)
    return (): void => {
      window.removeEventListener('playlistRefresh', handlePlaylistRefresh)
    }
  }, [refetchPlaylist])

  // Use the auto-remove hook
  useAutoRemoveFinishedTrack({
    currentTrackId,
    playlistTracks: tracks,
    playbackState: playbackState ?? null,
    playlistId: fixedPlaylistId ?? '',
    songsBetweenRepeats
  })

  const upcomingTracks = useMemo(
    (): TrackItem[] => filterUpcomingTracks(tracks, currentTrackId) ?? [],
    [tracks, currentTrackId]
  )

  // Only refresh when current track changes
  useEffect((): void => {
    if (currentTrackId !== previousTrackIdRef.current) {
      previousTrackIdRef.current = currentTrackId
      void refetchPlaylist().catch((error) => {
        console.error('[Playlist] Error refreshing playlist:', error)
      })
    }
  }, [currentTrackId, refetchPlaylist])

  // If no track is currently playing, show all tracks
  const tracksToShow = useMemo(
    (): TrackItem[] => (currentTrackId ? upcomingTracks : tracks),
    [currentTrackId, upcomingTracks, tracks]
  )

  if (!tracksToShow?.length) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full overflow-hidden rounded-lg bg-primary-100 shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <div className='flex w-full flex-col'>
            <NowPlaying nowPlaying={playbackState} />
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
          <NowPlaying nowPlaying={playbackState} />

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
})

Playlist.displayName = 'Playlist'

export default Playlist
