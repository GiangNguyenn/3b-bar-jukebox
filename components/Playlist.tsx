import { TrackItem } from '@/shared/types'
import React, { useState } from 'react'
import QueueItem from '@/components/Playlist/QueueItem'
import NowPlaying from '@/components/Playlist/NowPlaying'
import useNowPlayingTrack from '@/hooks/useNowPlayingTrack'
import { filterUpcomingTracks } from '@/lib/utils'
import { FALLBACK_GENRES } from '@/shared/constants/trackSuggestion'

interface TrackSuggestionsState {
  genres: string[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  songsBetweenRepeats: number
}

interface IPlaylistProps {
  tracks: TrackItem[]
}

const Playlist: React.FC<IPlaylistProps> = ({ tracks }): JSX.Element => {
  const { data: playbackState } = useNowPlayingTrack()
  const currentTrackId = playbackState?.item?.id ?? null
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async (): Promise<void> => {
    try {
      setIsRefreshing(true)

      // Get track suggestions state from localStorage
      const savedState = localStorage.getItem('track-suggestions-state')
      const trackSuggestionsState = savedState
        ? (JSON.parse(savedState) as Partial<TrackSuggestionsState>)
        : {
            genres: Array.from(FALLBACK_GENRES),
            yearRange: [1950, new Date().getFullYear()],
            popularity: 50,
            allowExplicit: false,
            maxSongLength: 300,
            songsBetweenRepeats: 5
          }

      const response = await fetch('/api/refresh-site', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          genres: trackSuggestionsState.genres ?? Array.from(FALLBACK_GENRES),
          yearRangeStart: trackSuggestionsState.yearRange?.[0] ?? 1950,
          yearRangeEnd:
            trackSuggestionsState.yearRange?.[1] ?? new Date().getFullYear(),
          popularity: trackSuggestionsState.popularity ?? 50,
          allowExplicit: trackSuggestionsState.allowExplicit ?? false,
          maxSongLength: trackSuggestionsState.maxSongLength ?? 300,
          songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats ?? 5
        })
      })

      if (!response.ok) {
        throw new Error('Failed to refresh site')
      }
      // Visual feedback that refresh was successful
      window.dispatchEvent(
        new CustomEvent('playlistRefresh', {
          detail: { timestamp: Date.now() }
        })
      )
    } catch (error) {
      console.error('Error refreshing site:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  const upcomingTracks = filterUpcomingTracks(tracks, currentTrackId) ?? []
  const tracksToShow = currentTrackId ? upcomingTracks : tracks

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
              <button
                onClick={() => {
                  void handleRefresh()
                }}
                disabled={isRefreshing}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  isRefreshing
                    ? 'cursor-not-allowed bg-gray-300 text-gray-500'
                    : 'text-white bg-blue-600 hover:bg-blue-500'
                } `}
              >
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
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
