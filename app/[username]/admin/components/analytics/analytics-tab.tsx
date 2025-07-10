'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Loading } from '@/components/ui/loading'
import { ErrorMessage } from '@/components/ui/error-message'
import { type Database } from '@/types/supabase'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { SpotifyApiService } from '@/services/spotifyApi'
import { showToast } from '@/lib/toast'
import { useUpcomingTracks } from '@/hooks/useUpcomingTracks'
import { usePlaylistData } from '@/hooks/usePlaylistData'
import { useCurrentlyPlaying } from '@/hooks/useCurrentlyPlaying'
import ReleaseYearHistogram from './release-year-histogram'
import { TrackItem } from '@/shared/types/spotify'

interface TopTrack {
  count: number
  name: string
  artist: string
  spotify_track_id: string
}

type RawTrackData = {
  count: number
  tracks: {
    name: string
    artist: string
    spotify_track_id: string
  } | null
}

const useTopTracks = (): {
  tracks: TopTrack[]
  isLoading: boolean
  error: string | null
} => {
  const [tracks, setTracks] = useState<TopTrack[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const fetchTopTracks = async (): Promise<void> => {
      try {
        setIsLoading(true)
        const { data: rawData, error } = await supabase
          .from('suggested_tracks')
          .select('count, tracks(name, artist, spotify_track_id)')
          .order('count', { ascending: false })
          .limit(50)

        if (error) {
          throw new Error(error.message)
        }

        if (rawData) {
          const formattedTracks = (rawData as unknown as RawTrackData[])
            .map((item) => {
              const trackData = item.tracks
              if (!trackData) {
                return null
              }
              return {
                count: item.count,
                name: trackData.name,
                artist: trackData.artist,
                spotify_track_id: trackData.spotify_track_id
              }
            })
            .filter((track): track is TopTrack => track !== null)
          setTracks(formattedTracks)
        } else {
          setTracks([])
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'An unknown error occurred'
        )
      } finally {
        setIsLoading(false)
      }
    }

    void fetchTopTracks()
  }, [supabase])

  return { tracks, isLoading, error }
}

export const AnalyticsTab = (): JSX.Element => {
  const { tracks, isLoading, error } = useTopTracks()
  const { fixedPlaylistId } = useFixedPlaylist()
  const { playlist } = usePlaylistData(fixedPlaylistId ?? '')
  const { currentlyPlaying } = useCurrentlyPlaying()
  const upcomingTracks = useUpcomingTracks(playlist, currentlyPlaying)
  const [isAdding, setIsAdding] = useState(false)

  const handleAddToPlaylist = async (): Promise<void> => {
    setIsAdding(true)
    try {
      const upcomingTrackIds = new Set(
        (upcomingTracks || []).map((track: TrackItem) => track.track.id)
      )
      const newTracks = tracks.filter(
        (track) => !upcomingTrackIds.has(track.spotify_track_id)
      )

      if (newTracks.length === 0) {
        showToast('No new tracks to add.', 'info')
        setIsAdding(false)
        return
      }

      const trackUris = newTracks.map(
        (track) => `spotify:track:${track.spotify_track_id}`
      )

      if (!fixedPlaylistId) {
        showToast('No fixed playlist is set.', 'warning')
        return
      }

      await SpotifyApiService.getInstance().addItemsToPlaylist(
        fixedPlaylistId,
        trackUris
      )

      const trackCount = trackUris.length
      showToast(
        `Successfully added ${trackCount} ${
          trackCount === 1 ? 'track' : 'tracks'
        } to the playlist.`,
        'success'
      )
    } catch (error) {
      showToast('Failed to add tracks to playlist.', 'warning')
      console.error(error)
    } finally {
      setIsAdding(false)
    }
  }

  if (isLoading) {
    return <Loading message='Loading top tracks...' />
  }

  if (error) {
    return <ErrorMessage message={error} />
  }

  return (
    <div className='p-4'>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='text-2xl font-bold'>Top 50 Suggested Tracks</h2>
        <button
          onClick={() => {
            void handleAddToPlaylist()
          }}
          disabled={isLoading || isAdding || tracks.length === 0}
          className='text-white rounded bg-blue-500 px-4 py-2 disabled:bg-gray-400'
        >
          {isAdding ? 'Adding...' : 'Add to playlist'}
        </button>
      </div>
      {tracks.length === 0 ? (
        <p>No tracks have been suggested yet.</p>
      ) : (
        <table className='min-w-full'>
          <thead>
            <tr>
              <th className='border-b px-4 py-2 text-left'>Count</th>
              <th className='border-b px-4 py-2 text-left'>Track</th>
              <th className='border-b px-4 py-2 text-left'>Artist</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, index) => (
              <tr key={index}>
                <td className='border-b px-4 py-2 text-center'>
                  {track.count}
                </td>
                <td className='border-b px-4 py-2'>{track.name}</td>
                <td className='border-b px-4 py-2'>{track.artist}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className='mt-8'>
        <h2 className='mb-4 text-2xl font-bold'>
          Track Release Year Distribution
        </h2>
        <ReleaseYearHistogram />
      </div>
    </div>
  )
}
