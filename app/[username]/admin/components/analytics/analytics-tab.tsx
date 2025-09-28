'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { RealtimeChannel } from '@supabase/supabase-js'
import { Loading } from '@/components/ui/loading'
import { ErrorMessage } from '@/components/ui/error-message'
import { type Database } from '@/types/supabase'
import { showToast } from '@/lib/toast'
import { usePlaylistData } from '@/hooks/usePlaylistData'
import ReleaseYearHistogram from './release-year-histogram'
import PopularityHistogram from './popularity-histogram'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { useSubscription } from '@/hooks/useSubscription'
import { useGetProfile } from '@/hooks/useGetProfile'

interface TopTrack {
  count: number
  name: string
  artist: string
  spotify_track_id: string
  track_id: string // UUID from tracks table
}

interface TopArtist {
  artist: string
  total_count: number
  unique_tracks: number
  most_popular_track: string
  most_popular_track_count: number
}

interface TopGenre {
  genre: string
  total_count: number
  unique_tracks: number
  most_popular_track: string
  most_popular_track_count: number
}

type RawTrackData = {
  count: number
  track_id: string
  tracks: {
    name: string
    artist: string
    spotify_track_id: string
  } | null
}



const useTopTracks = (
  shouldFetchData: boolean = true
): {
  tracks: TopTrack[]
  isLoading: boolean
  error: string | null
  optimisticUpdate: (updater: (currentTracks: TopTrack[]) => TopTrack[]) => void
} => {
  const [tracks, setTracks] = useState<TopTrack[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const { addLog } = useConsoleLogsContext()
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const subscriptionRef = useRef<RealtimeChannel | null>(null)

  // Track if we've already fetched data for this shouldFetchData state
  const hasFetchedRef = useRef(false)

  // Direct fetch when shouldFetchData becomes true
  useEffect(() => {
    if (shouldFetchData && !hasFetchedRef.current) {
      hasFetchedRef.current = true
      setIsLoading(true)
      // Call fetchTopTracks directly
      void (async (): Promise<void> => {
        try {
          const { data: rawData, error } = await supabase
            .from('suggested_tracks')
            .select(
              `
              count,
              track_id,
              tracks(name, artist, spotify_track_id, id)
            `
            )
            .order('count', { ascending: false })
            .limit(50)

          if (error) {
            addLog(
              'ERROR',
              `Failed to fetch suggested tracks: ${error.message}`,
              'useTopTracks',
              error
            )
            setError(error.message)
          } else {
            const formattedTracks = (rawData as unknown as RawTrackData[])
              .map((item): TopTrack | null => {
                const trackData = item.tracks
                if (!trackData) {
                  addLog(
                    'WARN',
                    `No track data for item: ${item.track_id}`,
                    'useTopTracks'
                  )
                  return null
                }
                return {
                  count: item.count,
                  name: trackData.name,
                  artist: trackData.artist,
                  spotify_track_id: trackData.spotify_track_id,
                  track_id: item.track_id
                }
              })
              .filter((track): track is TopTrack => track !== null)

            setTracks(formattedTracks)
          }
        } catch (err) {
          /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
          const errorMessage =
            err instanceof Error ? err.message : 'An unknown error occurred'
          setError(errorMessage)
          addLog(
            'ERROR',
            `Failed to fetch top tracks: ${errorMessage}`,
            'useTopTracks',
            err instanceof Error ? err : undefined
          )
          /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
        } finally {
          setIsLoading(false)
        }
      })()
    } else if (!shouldFetchData) {
      hasFetchedRef.current = false
    }
  }, [shouldFetchData, supabase, addLog])

  // Optimistic update function
  const optimisticUpdate = useCallback(
    (updater: (currentTracks: TopTrack[]) => TopTrack[]) => {
      setTracks((prevTracks) => updater(prevTracks))
    },
    []
  )

  // Fetch top tracks data
  const fetchTopTracks = useCallback(async (): Promise<void> => {
    // If data fetching is disabled, return early
    if (!shouldFetchData) {
      addLog(
        'INFO',
        `[useTopTracks] Data fetching disabled - shouldFetchData: ${shouldFetchData}`,
        'useTopTracks'
      )
      setIsLoading(false)
      setError(null)
      setTracks([])
      return
    }

    addLog(
      'INFO',
      `[useTopTracks] Starting to fetch top tracks - shouldFetchData: ${shouldFetchData}`,
      'useTopTracks'
    )

    try {
      setIsLoading(true)
      setError(null)

      const { data: rawData, error } = await supabase
        .from('suggested_tracks')
        .select(
          `
          count,
          track_id,
          tracks(name, artist, spotify_track_id, id)
        `
        )
        .order('count', { ascending: false })
        .limit(50)

      if (error) {
        addLog(
          'ERROR',
          `Failed to fetch suggested tracks: ${error.message}`,
          'useTopTracks',
          error
        )
        throw new Error(error.message)
      }

      if (rawData) {
        const formattedTracks = (rawData as unknown as RawTrackData[])
          .map((item) => {
            const trackData = item.tracks
            if (!trackData) {
              addLog(
                'WARN',
                `No track data for item: ${item.track_id}`,
                'useTopTracks'
              )
              return null
            }
            return {
              count: item.count,
              name: trackData.name,
              artist: trackData.artist,
              spotify_track_id: trackData.spotify_track_id,
              track_id: item.track_id // Add track_id to the returned object
            }
          })
          .filter((track): track is TopTrack => track !== null)

        setTracks(formattedTracks)
        setTracks(formattedTracks)
      } else {
        setTracks([])
      }
    } catch (err) {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
      const errorMessage =
        err instanceof Error ? err.message : 'An unknown error occurred'
      setError(errorMessage)
      addLog(
        'ERROR',
        `Failed to fetch top tracks: ${errorMessage}`,
        'useTopTracks',
        err instanceof Error ? err : undefined
      )
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
    } finally {
      setIsLoading(false)
    }
  }, [supabase, addLog, shouldFetchData])

  // Set up real-time subscription for suggested_tracks and tracks tables
  const setupRealtimeSubscription = useCallback(async (): Promise<void> => {
    if (subscriptionRef.current) {
      await supabase.removeChannel(subscriptionRef.current)
    }

    try {
      const subscription = supabase
        .channel('suggested_tracks_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'suggested_tracks'
          },
          () => {
            // Refresh data when suggested_tracks changes
            void fetchTopTracks()
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'tracks'
          },
          () => {
            // Refresh data when tracks changes (affects suggested_tracks joins)
            void fetchTopTracks()
          }
        )
        .subscribe((status) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          if (
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            status === 'CHANNEL_ERROR'
          ) {
            addLog(
              'ERROR',
              'Real-time subscription for suggested tracks failed',
              'useTopTracks'
            )
          }
        })

      subscriptionRef.current = subscription
    } catch (err) {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
      addLog(
        'ERROR',
        `Failed to set up real-time subscription: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'useTopTracks',
        err instanceof Error ? err : undefined
      )
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
    }
  }, [supabase, fetchTopTracks, addLog])

  // Initial setup
  useEffect(() => {
    const initialize = async (): Promise<void> => {
      addLog(
        'INFO',
        `[useTopTracks] Initializing - shouldFetchData: ${shouldFetchData}`,
        'useTopTracks'
      )

      // Fetch initial data
      await fetchTopTracks()

      // Set up real-time subscription only if data fetching is enabled
      if (shouldFetchData) {
        await setupRealtimeSubscription()
      }
    }

    void initialize()

    // Cleanup on unmount
    return (): void => {
      if (subscriptionRef.current) {
        void supabase.removeChannel(subscriptionRef.current)
        subscriptionRef.current = null
      }
    }
  }, [
    shouldFetchData,
    addLog,
    fetchTopTracks,
    setupRealtimeSubscription,
    supabase
  ])

  return { tracks, isLoading, error, optimisticUpdate }
}

const useTopArtists = (
  shouldFetchData: boolean = true
): {
  artists: TopArtist[]
  isLoading: boolean
  error: string | null
} => {
  const [artists, setArtists] = useState<TopArtist[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const { addLog } = useConsoleLogsContext()
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Fetch top artists data
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
  const fetchTopArtists = useCallback(async (): Promise<void> => {
    // If data fetching is disabled, return early
    if (!shouldFetchData) {
      addLog(
        'INFO',
        `[useTopArtists] Data fetching disabled - shouldFetchData: ${shouldFetchData}`,
        'useTopArtists'
      )
      setIsLoading(false)
      setError(null)
      setArtists([])
      return
    }

    addLog(
      'INFO',
      `[useTopArtists] Starting to fetch top artists - shouldFetchData: ${shouldFetchData}`,
      'useTopArtists'
    )

    try {
      setIsLoading(true)
      setError(null)

      // Query to get top 5 artists with aggregated data
      const { data: rawData, error } = await supabase
        .from('suggested_tracks')
        .select(
          `
          count,
          tracks!inner(
            artist,
            name
          )
        `
        )
        .order('count', { ascending: false })

      if (error) {
        addLog(
          'ERROR',
          `Failed to fetch suggested tracks for artists: ${error.message}`,
          'useTopArtists',
          error
        )
        throw new Error(error.message)
      }

      if (rawData) {
        // Process the data to aggregate by artist
        const artistMap = new Map<
          string,
          {
            total_count: number
            tracks: Set<string>
            track_counts: Map<string, number>
          }
        >()

        // Aggregate data by artist
        rawData.forEach((item) => {
          // Handle the case where tracks is an array from the inner join
          const trackData = Array.isArray(item.tracks)
            ? item.tracks[0]
            : item.tracks
          if (!trackData) return

          const artist = trackData.artist
          const trackName = trackData.name
          const count = item.count

          if (!artistMap.has(artist)) {
            artistMap.set(artist, {
              total_count: 0,
              tracks: new Set(),
              track_counts: new Map()
            })
          }

          const artistData = artistMap.get(artist)!
          artistData.total_count += count
          artistData.tracks.add(trackName)
          artistData.track_counts.set(trackName, count)
        })

        // Convert to array and sort by total count
        const sortedArtists = Array.from(artistMap.entries())
          .map(([artist, data]) => {
            // Find the most popular track for this artist
            let mostPopularTrack = ''
            let mostPopularCount = 0
            data.track_counts.forEach((count, trackName) => {
              if (count > mostPopularCount) {
                mostPopularCount = count
                mostPopularTrack = trackName
              }
            })

            return {
              artist,
              total_count: data.total_count,
              unique_tracks: data.tracks.size,
              most_popular_track: mostPopularTrack,
              most_popular_track_count: mostPopularCount
            }
          })
          .sort((a, b) => b.total_count - a.total_count)
          .slice(0, 5) // Get top 5

        setArtists(sortedArtists)
      } else {
        setArtists([])
      }
    } catch (err) {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
      const errorMessage =
        err instanceof Error ? err.message : 'An unknown error occurred'
      setError(errorMessage)
      addLog(
        'ERROR',
        `Failed to fetch top artists: ${errorMessage}`,
        'useTopArtists',
        err instanceof Error ? err : undefined
      )
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
    } finally {
      setIsLoading(false)
    }
  }, [supabase, addLog, shouldFetchData])
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */

  // Initial fetch
  useEffect(() => {
    void fetchTopArtists()
  }, [fetchTopArtists])

  return { artists, isLoading, error }
}

const useTopGenres = (
  shouldFetchData: boolean = true
): {
  genres: TopGenre[]
  isLoading: boolean
  error: string | null
} => {
  const [genres, setGenres] = useState<TopGenre[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const { addLog } = useConsoleLogsContext()
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Fetch top genres data
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
  const fetchTopGenres = useCallback(async (): Promise<void> => {
    // If data fetching is disabled, return early
    if (!shouldFetchData) {
      addLog(
        'INFO',
        `[useTopGenres] Data fetching disabled - shouldFetchData: ${shouldFetchData}`,
        'useTopGenres'
      )
      setIsLoading(false)
      setError(null)
      setGenres([])
      return
    }

    addLog(
      'INFO',
      `[useTopGenres] Starting to fetch top genres - shouldFetchData: ${shouldFetchData}`,
      'useTopGenres'
    )

    try {
      setIsLoading(true)
      setError(null)

      // Query to get top 5 genres with aggregated data
      const { data: rawData, error } = await supabase
        .from('suggested_tracks')
        .select(
          `
          count,
          tracks!inner(
            genre,
            name
          )
        `
        )
        .order('count', { ascending: false })

      if (error) {
        addLog(
          'ERROR',
          `Failed to fetch suggested tracks for genres: ${error.message}`,
          'useTopGenres',
          error
        )
        throw new Error(error.message)
      }

      if (rawData) {
        // Process the data to aggregate by genre
        const genreMap = new Map<
          string,
          {
            total_count: number
            tracks: Set<string>
            track_counts: Map<string, number>
          }
        >()

        // Aggregate data by genre
        rawData.forEach((item) => {
          // Handle the case where tracks is an array from the inner join
          const trackData = Array.isArray(item.tracks)
            ? item.tracks[0]
            : item.tracks
          if (!trackData) return

          const genre = trackData.genre
          const trackName = trackData.name
          const count = item.count

          // Skip tracks with null or empty genre
          if (!genre || (typeof genre === 'string' && genre.trim() === '')) {
            return
          }

          if (!genreMap.has(genre)) {
            genreMap.set(genre, {
              total_count: 0,
              tracks: new Set(),
              track_counts: new Map()
            })
          }

          const genreData = genreMap.get(genre)!
          genreData.total_count += count
          genreData.tracks.add(trackName)
          genreData.track_counts.set(trackName, count)
        })

        // Convert to array and sort by total count
        const sortedGenres = Array.from(genreMap.entries())
          .map(([genre, data]) => {
            // Find the most popular track for this genre
            let mostPopularTrack = ''
            let mostPopularCount = 0
            data.track_counts.forEach((count, trackName) => {
              if (count > mostPopularCount) {
                mostPopularCount = count
                mostPopularTrack = trackName
              }
            })

            return {
              genre,
              total_count: data.total_count,
              unique_tracks: data.tracks.size,
              most_popular_track: mostPopularTrack,
              most_popular_track_count: mostPopularCount
            }
          })
          .sort((a, b) => b.total_count - a.total_count)
          .slice(0, 5) // Get top 5

        setGenres(sortedGenres)
      } else {
        setGenres([])
      }
    } catch (err) {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
      const errorMessage =
        err instanceof Error ? err.message : 'An unknown error occurred'
      setError(errorMessage)
      addLog(
        'ERROR',
        `Failed to fetch top genres: ${errorMessage}`,
        'useTopGenres',
        err instanceof Error ? err : undefined
      )
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
    } finally {
      setIsLoading(false)
    }
  }, [supabase, addLog, shouldFetchData])
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */

  // Initial fetch
  useEffect(() => {
    void fetchTopGenres()
  }, [fetchTopGenres])

  return { genres, isLoading, error }
}

interface AnalyticsTabProps {
  username: string | undefined
}

export const AnalyticsTab = ({ username }: AnalyticsTabProps): JSX.Element => {
  // Get current user's profile and subscription status
  const {
    profile,
    loading: profileLoading,
    error: profileError
  } = useGetProfile()

  const { hasPremiumAccess, isLoading: subscriptionLoading } = useSubscription(
    profile?.id
  )

  // Only fetch data if user has premium access
  const shouldFetchData = hasPremiumAccess === true

  const { tracks, isLoading, error, optimisticUpdate } =
    useTopTracks(shouldFetchData)
  const {
    artists: topArtists,
    isLoading: artistsLoading,
    error: artistsError
  } = useTopArtists(shouldFetchData)
  const {
    genres: topGenres,
    isLoading: genresLoading,
    error: genresError
  } = useTopGenres(shouldFetchData)
  const { data: queue, optimisticUpdate: queueOptimisticUpdate } =
    usePlaylistData(username)
  const [isAdding, setIsAdding] = useState(false)
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null)
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null)
  const [isTopTracksCollapsed, setIsTopTracksCollapsed] = useState(true)
  const [isTopArtistsCollapsed, setIsTopArtistsCollapsed] = useState(true)
  const [isTopGenresCollapsed, setIsTopGenresCollapsed] = useState(true)
  const [isReleaseYearCollapsed, setIsReleaseYearCollapsed] = useState(true)
  const [isPopularityCollapsed, setIsPopularityCollapsed] = useState(true)
  const { addLog } = useConsoleLogsContext()

  // Handle deleting a suggested track
  const handleDeleteTrack = useCallback(
    async (track: TopTrack): Promise<void> => {
      if (!track.track_id) {
        showToast('Track ID not found.', 'warning')
        return
      }

      setDeletingTrackId(track.track_id)
      try {
        addLog(
          'INFO',
          `Deleting suggested track: ${track.name}`,
          'AnalyticsTab'
        )

        // Optimistic update - remove track from list immediately
        optimisticUpdate((currentTracks) =>
          currentTracks.filter((t) => t.track_id !== track.track_id)
        )

        const response = await fetch('/api/suggested-tracks/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: track.track_id })
        })

        if (response.ok) {
          showToast(
            `Successfully deleted "${track.name}" from suggested tracks.`,
            'success'
          )
          addLog(
            'INFO',
            `Successfully deleted suggested track: ${track.name}`,
            'AnalyticsTab'
          )
        } else {
          const errorData = (await response.json()) as { error?: string }
          showToast(`Failed to delete track: ${errorData.error}`, 'warning')
          addLog(
            'ERROR',
            `Failed to delete suggested track ${track.name}: ${errorData.error}`,
            'AnalyticsTab'
          )
          // Revert optimistic update on error
          optimisticUpdate((currentTracks) => [...currentTracks, track])
        }
      } catch (error) {
        showToast('An error occurred while deleting the track.', 'warning')
        addLog(
          'ERROR',
          `Error deleting suggested track ${track.name}`,
          'AnalyticsTab',
          error instanceof Error ? error : undefined
        )
        // Revert optimistic update on error
        optimisticUpdate((currentTracks) => [...currentTracks, track])
      } finally {
        setDeletingTrackId(null)
      }
    },
    [optimisticUpdate, addLog]
  )

  // Check if a track is already in the playlist
  const isTrackInPlaylist = useCallback(
    (trackId: string): boolean => {
      return (queue ?? []).some(
        (item: JukeboxQueueItem) => item.tracks.spotify_track_id === trackId
      )
    },
    [queue]
  )

  // Handle adding a single track to playlist
  const handleAddSingleTrack = useCallback(
    async (track: TopTrack): Promise<void> => {
      if (!username) {
        showToast('Username not found.', 'warning')
        return
      }

      if (isTrackInPlaylist(track.spotify_track_id)) {
        showToast('Track is already in the playlist.', 'info')
        return
      }

      setAddingTrackId(track.spotify_track_id)
      try {
        addLog(
          'INFO',
          `Adding single track to playlist: ${track.name}`,
          'AnalyticsTab'
        )

        // Optimistic update - add track to queue immediately
        if (queueOptimisticUpdate && queue) {
          const newQueueItem = {
            id: `temp-${Date.now()}-${Math.random()}`, // Temporary ID
            profile_id: '', // Will be set by backend
            track_id: '', // Will be set by backend
            votes: 1, // Single track gets 1 vote
            queued_at: new Date().toISOString(),
            tracks: {
              id: track.spotify_track_id,
              spotify_track_id: track.spotify_track_id,
              name: track.name,
              artist: track.artist,
              album: 'Unknown Album',
              genre: null,
              created_at: new Date().toISOString(),
              popularity: 0,
              duration_ms: 0,
              spotify_url: `spotify:track:${track.spotify_track_id}`,
              release_year: 0
            }
          }

          queueOptimisticUpdate((currentQueue) => [
            ...currentQueue,
            newQueueItem
          ])
          addLog(
            'INFO',
            'Optimistic update: Added single track to queue UI',
            'AnalyticsTab'
          )
        }

        const response = await fetch(`/api/playlist/${username}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracks: {
              id: track.spotify_track_id,
              name: track.name,
              artists: [{ name: track.artist }],
              album: { name: 'Unknown Album' },
              duration_ms: 0,
              popularity: 0,
              uri: `spotify:track:${track.spotify_track_id}`
            },
            initialVotes: 1, // Single track gets 1 vote
            source: 'admin' // Mark as admin-initiated
          })
        })

        if (response.ok) {
          showToast(`Added "${track.name}" to the playlist.`, 'success')
          addLog(
            'INFO',
            `Successfully added single track to queue: ${track.name}`,
            'AnalyticsTab'
          )
        } else {
          const errorData = (await response.json()) as { error?: string }
          showToast(
            `Failed to add "${track.name}": ${errorData.error}`,
            'warning'
          )
          addLog(
            'ERROR',
            `Failed to add single track ${track.name}: ${errorData.error}`,
            'AnalyticsTab'
          )
        }
      } catch (error) {
        showToast(`Error adding "${track.name}" to the playlist.`, 'warning')
        addLog(
          'ERROR',
          `Error adding single track ${track.name}`,
          'AnalyticsTab',
          error instanceof Error ? error : undefined
        )
      } finally {
        setAddingTrackId(null)
      }
    },
    [username, isTrackInPlaylist, queueOptimisticUpdate, queue, addLog]
  )

  const handleAddToPlaylist = async (): Promise<void> => {
    setIsAdding(true)
    try {
      if (!username) {
        showToast('Username not found.', 'warning')
        setIsAdding(false)
        return
      }

      const upcomingTrackIds = new Set(
        (queue ?? []).map(
          (item: JukeboxQueueItem) => item.tracks.spotify_track_id
        )
      )
      const newTracks = tracks.filter(
        (track) => !upcomingTrackIds.has(track.spotify_track_id)
      )

      if (newTracks.length === 0) {
        showToast('No new tracks to add.', 'info')
        setIsAdding(false)
        return
      }

      addLog(
        'INFO',
        `Adding ${newTracks.length} tracks to playlist from analytics`,
        'AnalyticsTab'
      )

      // Optimistic update - add tracks to queue immediately
      if (queueOptimisticUpdate && queue) {
        const newQueueItems = newTracks.map((track) => ({
          id: `temp-${Date.now()}-${Math.random()}`, // Temporary ID
          profile_id: '', // Will be set by backend
          track_id: '', // Will be set by backend
          votes: 2, // From Analytics
          queued_at: new Date().toISOString(),
          tracks: {
            id: track.spotify_track_id,
            spotify_track_id: track.spotify_track_id,
            name: track.name,
            artist: track.artist,
            album: 'Unknown Album',
            genre: null,
            created_at: new Date().toISOString(),
            popularity: 0,
            duration_ms: 0,
            spotify_url: `spotify:track:${track.spotify_track_id}`,
            release_year: 0
          }
        }))

        queueOptimisticUpdate((currentQueue) => [
          ...currentQueue,
          ...newQueueItems
        ])
        addLog(
          'INFO',
          'Optimistic update: Added tracks to queue UI',
          'AnalyticsTab'
        )
      }

      let addedCount = 0
      for (const track of newTracks) {
        try {
          const response = await fetch(`/api/playlist/${username}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracks: {
                id: track.spotify_track_id,
                name: track.name,
                artists: [{ name: track.artist }],
                album: { name: 'Unknown Album' },
                duration_ms: 0,
                popularity: 0,
                uri: `spotify:track:${track.spotify_track_id}`
              },
              initialVotes: 2, // From Analytics
              source: 'admin' // Mark as admin-initiated
            })
          })
          if (response.ok) {
            addedCount++
            addLog(
              'INFO',
              `Successfully added track to queue: ${track.name}`,
              'AnalyticsTab'
            )
          } else {
            const errorData = (await response.json()) as { error?: string }
            addLog(
              'ERROR',
              `Failed to add track ${track.name}: ${errorData.error}`,
              'AnalyticsTab'
            )
          }
        } catch (error) {
          addLog(
            'ERROR',
            `Error adding track ${track.name}`,
            'AnalyticsTab',
            error instanceof Error ? error : undefined
          )
        }
      }

      if (addedCount > 0) {
        showToast(
          `Successfully added ${addedCount} ${
            addedCount === 1 ? 'track' : 'tracks'
          } to the queue.`,
          'success'
        )
        addLog(
          'INFO',
          `Successfully added ${addedCount} tracks to queue from analytics`,
          'AnalyticsTab'
        )
      } else {
        showToast('Failed to add any new tracks to the queue.', 'warning')
        addLog(
          'WARN',
          'Failed to add any tracks to queue from analytics',
          'AnalyticsTab'
        )
      }
    } catch (error) {
      showToast('An unexpected error occurred.', 'warning')
      addLog(
        'ERROR',
        'Unexpected error in handleAddToPlaylist',
        'AnalyticsTab',
        error instanceof Error ? error : undefined
      )
    } finally {
      setIsAdding(false)
    }
  }

  // Show loading while checking subscription status
  if (profileLoading || subscriptionLoading) {
    return <Loading message='Checking premium access...' />
  }

  // Show error if profile or subscription check failed
  if (profileError || error || artistsError || genresError) {
    return (
      <ErrorMessage
        message={
          profileError ??
          error ??
          artistsError ??
          genresError ??
          'Failed to load analytics'
        }
      />
    )
  }

  // If no premium access, show empty state
  if (!shouldFetchData) {
    return (
      <div className='p-4'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-2xl font-bold'>Top 50 Suggested Tracks</h2>
        </div>
        <div className='py-8 text-center'>
          <p className='text-gray-400'>
            Analytics are only available with Premium Access.
          </p>
        </div>
      </div>
    )
  }

  // Show loading while fetching analytics data
  if (isLoading || artistsLoading || genresLoading) {
    return <Loading message='Loading analytics data...' />
  }

  return (
    <div className='p-4'>
      {/* Top 50 Suggested Tracks - Collapsible Section */}
      <div className='rounded-lg border'>
        <button
          type='button'
          onClick={(): void => setIsTopTracksCollapsed(!isTopTracksCollapsed)}
          className='flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50'
        >
          <div className='flex items-center gap-4'>
            <h2 className='text-2xl font-bold'>Top 50 Suggested Tracks</h2>
            <button
              onClick={(e) => {
                e.stopPropagation()
                void handleAddToPlaylist()
              }}
              disabled={isLoading || isAdding || tracks.length === 0}
              className='text-white rounded bg-blue-500 px-4 py-2 disabled:bg-gray-400'
            >
              {isAdding ? 'Adding...' : 'Add All Tracks'}
            </button>
          </div>
          <svg
            className={`h-5 w-5 text-gray-500 transition-transform ${
              isTopTracksCollapsed ? 'rotate-180' : ''
            }`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </button>
        {!isTopTracksCollapsed && (
          <div className='px-4 pb-4'>
            {tracks.length === 0 ? (
              <p>No tracks have been suggested yet.</p>
            ) : (
              <table className='min-w-full'>
                <thead>
                  <tr>
                    <th className='border-b px-4 py-2 text-left'>Count</th>
                    <th className='border-b px-4 py-2 text-left'>Track</th>
                    <th className='border-b px-4 py-2 text-left'>Artist</th>
                    <th className='border-b px-4 py-2 text-center'>
                      Add to Playlist
                    </th>
                    <th className='border-b px-4 py-2 text-center'>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track, index) => {
                    const isInPlaylist = isTrackInPlaylist(
                      track.spotify_track_id
                    )
                    const isAddingThisTrack =
                      addingTrackId === track.spotify_track_id
                    const isDeletingThisTrack =
                      deletingTrackId === track.track_id

                    return (
                      <tr key={index}>
                        <td className='border-b px-4 py-2 text-center'>
                          {track.count}
                        </td>
                        <td className='border-b px-4 py-2'>{track.name}</td>
                        <td className='border-b px-4 py-2'>{track.artist}</td>
                        <td className='border-b px-4 py-2 text-center'>
                          {!isInPlaylist ? (
                            <button
                              onClick={() => void handleAddSingleTrack(track)}
                              disabled={isAddingThisTrack}
                              className='text-white rounded bg-green-600 px-3 py-1 text-sm font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                              title={`Add "${track.name}" to playlist`}
                            >
                              {isAddingThisTrack ? (
                                <div className='flex items-center gap-1'>
                                  <Loading className='h-3 w-3' />
                                  <span>Adding...</span>
                                </div>
                              ) : (
                                '+'
                              )}
                            </button>
                          ) : (
                            <span className='text-sm text-gray-500'>
                              In playlist
                            </span>
                          )}
                        </td>
                        <td className='border-b px-4 py-2 text-center'>
                          {isDeletingThisTrack ? (
                            <Loading className='h-4 w-4' />
                          ) : (
                            <button
                              onClick={() => void handleDeleteTrack(track)}
                              disabled={isDeletingThisTrack}
                              className='text-white rounded bg-red-600 px-3 py-1 text-sm font-medium transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                              title={`Delete "${track.name}" from suggested tracks`}
                            >
                              -
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Top 5 Artists Section - Collapsible */}
      <div className='mt-8 rounded-lg border'>
        <button
          type='button'
          onClick={(): void => setIsTopArtistsCollapsed(!isTopArtistsCollapsed)}
          className='flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50'
        >
          <h2 className='text-2xl font-bold'>Top 5 Artists</h2>
          <svg
            className={`h-5 w-5 text-gray-500 transition-transform ${
              isTopArtistsCollapsed ? 'rotate-180' : ''
            }`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </button>
        {!isTopArtistsCollapsed && (
          <div className='px-4 pb-4'>
            {topArtists.length === 0 ? (
              <p>No artist data available yet.</p>
            ) : (
              <table className='min-w-full'>
                <thead>
                  <tr>
                    <th className='border-b px-4 py-2 text-left'>Rank</th>
                    <th className='border-b px-4 py-2 text-left'>Artist</th>
                    <th className='border-b px-4 py-2 text-left'>
                      Total Count
                    </th>
                    <th className='border-b px-4 py-2 text-left'>
                      Unique Tracks
                    </th>
                    <th className='border-b px-4 py-2 text-left'>
                      Most Popular Track
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topArtists.map((artist, index) => (
                    <tr key={index}>
                      <td className='border-b px-4 py-2 text-center'>
                        {index + 1}
                      </td>
                      <td className='border-b px-4 py-2'>{artist.artist}</td>
                      <td className='border-b px-4 py-2 text-center'>
                        {artist.total_count}
                      </td>
                      <td className='border-b px-4 py-2 text-center'>
                        {artist.unique_tracks}
                      </td>
                      <td className='border-b px-4 py-2'>
                        &quot;{artist.most_popular_track}&quot; (
                        {artist.most_popular_track_count})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Top 5 Genres Section - Collapsible */}
      <div className='mt-8 rounded-lg border'>
        <button
          type='button'
          onClick={(): void => setIsTopGenresCollapsed(!isTopGenresCollapsed)}
          className='flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50'
        >
          <h2 className='text-2xl font-bold'>Top 5 Genres</h2>
          <svg
            className={`h-5 w-5 text-gray-500 transition-transform ${
              isTopGenresCollapsed ? 'rotate-180' : ''
            }`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </button>
        {!isTopGenresCollapsed && (
          <div className='px-4 pb-4'>
            {topGenres.length === 0 ? (
              <p>No genre data available yet.</p>
            ) : (
              <table className='min-w-full'>
                <thead>
                  <tr>
                    <th className='border-b px-4 py-2 text-left'>Rank</th>
                    <th className='border-b px-4 py-2 text-left'>Genre</th>
                    <th className='border-b px-4 py-2 text-left'>
                      Total Count
                    </th>
                    <th className='border-b px-4 py-2 text-left'>
                      Unique Tracks
                    </th>
                    <th className='border-b px-4 py-2 text-left'>
                      Most Popular Track
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topGenres.map((genre, index) => (
                    <tr key={index}>
                      <td className='border-b px-4 py-2 text-center'>
                        {index + 1}
                      </td>
                      <td className='border-b px-4 py-2'>{genre.genre}</td>
                      <td className='border-b px-4 py-2 text-center'>
                        {genre.total_count}
                      </td>
                      <td className='border-b px-4 py-2 text-center'>
                        {genre.unique_tracks}
                      </td>
                      <td className='border-b px-4 py-2'>
                        &quot;{genre.most_popular_track}&quot; (
                        {genre.most_popular_track_count})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Track Release Year Distribution Section - Collapsible */}
      <div className='mt-8 rounded-lg border'>
        <button
          type='button'
          onClick={(): void =>
            setIsReleaseYearCollapsed(!isReleaseYearCollapsed)
          }
          className='flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50'
        >
          <h2 className='text-2xl font-bold'>Release Year</h2>
          <svg
            className={`h-5 w-5 text-gray-500 transition-transform ${
              isReleaseYearCollapsed ? 'rotate-180' : ''
            }`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </button>
        {!isReleaseYearCollapsed && (
          <div className='px-4 pb-4'>
            <ReleaseYearHistogram />
          </div>
        )}
      </div>

      {/* Track Popularity Distribution Section - Collapsible */}
      <div className='mt-8 rounded-lg border'>
        <button
          type='button'
          onClick={(): void => setIsPopularityCollapsed(!isPopularityCollapsed)}
          className='flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50'
        >
          <h2 className='text-2xl font-bold'>Song Popularity</h2>
          <svg
            className={`h-5 w-5 text-gray-500 transition-transform ${
              isPopularityCollapsed ? 'rotate-180' : ''
            }`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </button>
        {!isPopularityCollapsed && (
          <div className='px-4 pb-4'>
            <PopularityHistogram />
          </div>
        )}
      </div>
    </div>
  )
}
