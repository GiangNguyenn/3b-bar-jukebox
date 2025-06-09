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
  optimisticTrack?: TrackItem | null
}

const Playlist: React.FC<IPlaylistProps> = memo(
  ({ tracks, optimisticTrack }): JSX.Element => {
    const { data: playbackState, error: playbackError } = useNowPlayingTrack()
    const currentTrackId = playbackState?.item?.id ?? null
    const previousTrackIdRef = useRef<string | null>(null)
    const { fixedPlaylistId, isLoading: isPlaylistIdLoading } =
      useFixedPlaylist()
    const { refetchPlaylist } = useGetPlaylist(fixedPlaylistId)
    const { songsBetweenRepeats } = useTrackSuggestionsState()

    // Listen for playlist refresh events
    useEffect(() => {
      const handlePlaylistRefresh = (): void => {
        if (!fixedPlaylistId) {
          console.log('[Playlist] No playlist ID available, skipping refresh')
          return
        }
        void refetchPlaylist().catch((error) => {
          console.error('[Playlist] Error refreshing playlist:', error)
        })
      }

      window.addEventListener('playlistRefresh', handlePlaylistRefresh)
      return (): void => {
        window.removeEventListener('playlistRefresh', handlePlaylistRefresh)
      }
    }, [refetchPlaylist, fixedPlaylistId])

    // Use the auto-remove hook only if we have playback state
    useAutoRemoveFinishedTrack({
      currentTrackId,
      playlistTracks: tracks,
      playbackState: playbackState ?? null,
      playlistId: fixedPlaylistId ?? '',
      songsBetweenRepeats
    })

    // If we can't get playback state, show all tracks
    const tracksToShow = useMemo((): TrackItem[] => {
      if (playbackError) {
        console.log(
          '[Playlist] Error getting playback state, showing all tracks'
        )
        return tracks
      }
      const filteredTracks = currentTrackId
        ? (filterUpcomingTracks(tracks, currentTrackId) ?? [])
        : tracks

      // If we have an optimistic track and it's not in the filtered tracks, add it
      if (
        optimisticTrack &&
        !filteredTracks.some((t) => t.track.id === optimisticTrack.track.id)
      ) {
        return [...filteredTracks, optimisticTrack]
      }

      return filteredTracks
    }, [currentTrackId, tracks, playbackError, optimisticTrack])

    if (isPlaylistIdLoading) {
      return <div>Loading playlist...</div>
    }

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
                  {playbackError ? 'ALL TRACKS' : 'UPCOMING TRACKS'}
                </span>
              </div>
              {tracksToShow.map((track) => (
                <QueueItem
                  key={track.track.id}
                  track={track}
                  isPending={optimisticTrack?.track.id === track.track.id}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }
)

Playlist.displayName = 'Playlist'

export default Playlist
