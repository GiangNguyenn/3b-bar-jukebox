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
          const errorMessage =
            err instanceof Error ? err.message : 'An unknown error occurred'
          setError(errorMessage)
          addLog(
            'ERROR',
            `Failed to fetch top tracks: ${errorMessage}`,
            'useTopTracks',
            err instanceof Error ? err : undefined
          )
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
      const errorMessage =
        err instanceof Error ? err.message : 'An unknown error occurred'
      setError(errorMessage)
      addLog(
        'ERROR',
        `Failed to fetch top tracks: ${errorMessage}`,
        'useTopTracks',
        err instanceof Error ? err : undefined
      )
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
      addLog(
        'ERROR',
        `Failed to set up real-time subscription: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'useTopTracks',
        err instanceof Error ? err : undefined
      )
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
  const { data: queue, optimisticUpdate: queueOptimisticUpdate } =
    usePlaylistData(username)
  const [isAdding, setIsAdding] = useState(false)
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null)
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null)
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
  if (profileError || error) {
    return (
      <ErrorMessage
        message={profileError ?? error ?? 'Failed to load analytics'}
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
  if (isLoading) {
    return <Loading message='Loading top tracks...' />
  }

  return (
    <div className='p-4'>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='text-2xl font-bold'>Top 50 Suggested Tracks</h2>
        <div className='flex items-center gap-4'>
          <button
            onClick={() => {
              void handleAddToPlaylist()
            }}
            disabled={isLoading || isAdding || tracks.length === 0}
            className='text-white rounded bg-blue-500 px-4 py-2 disabled:bg-gray-400'
          >
            {isAdding ? 'Adding...' : 'Add All Tracks'}
          </button>
        </div>
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
              <th className='border-b px-4 py-2 text-center'>
                Add to Playlist
              </th>
              <th className='border-b px-4 py-2 text-center'>Delete</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, index) => {
              const isInPlaylist = isTrackInPlaylist(track.spotify_track_id)
              const isAddingThisTrack = addingTrackId === track.spotify_track_id
              const isDeletingThisTrack = deletingTrackId === track.track_id

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
                      <span className='text-sm text-gray-500'>In playlist</span>
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
      <div className='mt-8'>
        <h2 className='mb-4 text-2xl font-bold'>
          Track Release Year Distribution
        </h2>
        <ReleaseYearHistogram />
      </div>
    </div>
  )
}
