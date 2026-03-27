'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { useNowPlayingRealtime } from '@/hooks/useNowPlayingRealtime'
import { useArtistExtract } from '@/hooks/useArtistExtract'
import { usePlaylistData } from '@/hooks/usePlaylistData'
import { TrackDetails } from '@/shared/types/spotify'
import SearchInput from '@/components/SearchInput'
import Playlist from '@/components/Playlist/Playlist'
import { handleApiError } from '@/shared/utils/errorHandling'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import { useParams } from 'next/navigation'
import { PlaylistSkeleton, ErrorMessage, Toast } from '@/components/ui'
import { AutoFillNotification } from '@/components/ui/auto-fill-notification'
import { sendApiRequest } from '@/shared/api'
import { ApiError } from '@/shared/api'
import { sortQueueByPriority } from '@/shared/utils/queueSort'

type VoteFeedback = {
  message: string
  variant: 'success' | 'warning'
}

export default function PlaylistPage(): JSX.Element {
  const params = useParams()
  const username = params?.username as string | undefined
  const [voteFeedback, setVoteFeedback] = useState<VoteFeedback | null>(null)

  const {
    data: queue,
    error: playlistError,
    isRefreshing: isPlaylistRefreshing,
    mutate: refreshQueue,
    optimisticUpdate,
    profileId
  } = usePlaylistData(username)

  const { data: currentlyPlaying } = useNowPlayingRealtime({
    profileId,
    fallbackInterval: 30000
  })

  // Force refresh queue when currently playing track changes
  useEffect(() => {
    if (currentlyPlaying?.item?.id) {
      // Refresh queue to update the currently playing indicator
      void refreshQueue()
    }
  }, [currentlyPlaying?.item?.id, refreshQueue])

  const artistName = currentlyPlaying?.item?.artists[0]?.name
  const {
    data: extract,
    isLoading: isExtractLoading,
    error: extractError
  } = useArtistExtract(artistName)

  const [lastAddedTrack, setLastAddedTrack] = useState<TrackDetails | null>(
    null
  )
  const [pendingVoteIds, setPendingVoteIds] = useState<Record<string, boolean>>(
    {}
  )

  const handleAddTrack = useCallback(
    async (track: TrackDetails): Promise<void> => {
      if (!username) return

      // Create optimistic queue item
      const optimisticItem: JukeboxQueueItem = {
        id: `temp-${Date.now()}-${track.id}`, // Temporary ID
        profile_id: '', // Will be filled by the server
        track_id: '', // Will be filled by the server
        votes: 5, // Initial votes
        queued_at: new Date().toISOString(),
        tracks: {
          id: '', // Will be filled by the server
          spotify_track_id: track.id,
          name: track.name,
          artist: track.artists[0]?.name || 'Unknown Artist',
          album: track.album.name,
          genre: null,
          created_at: new Date().toISOString(),
          popularity: track.popularity,
          duration_ms: track.duration_ms,
          spotify_url: track.uri,
          release_year: new Date().getFullYear() // Default to current year
        }
      }

      // Optimistically add the track to the queue and sort by priority
      if (optimisticUpdate) {
        optimisticUpdate((currentQueue) => {
          const queueWithNewTrack = [optimisticItem, ...currentQueue]
          // Sort by votes DESC, queued_at ASC to match API ordering
          return sortQueueByPriority(queueWithNewTrack)
        })
      }

      try {
        await sendApiRequest<void>({
          path: `/playlist/${username}`,
          method: 'POST',
          isLocalApi: true,
          body: {
            tracks: track,
            initialVotes: 5,
            source: 'user' // Mark as user-initiated
          }
        })

        setLastAddedTrack(track)
        // The real-time subscription will update the queue with the actual data
        // so we don't need to call refreshQueue() here
      } catch (error: unknown) {
        // Remove the optimistic item on error
        if (optimisticUpdate) {
          optimisticUpdate((currentQueue) =>
            currentQueue.filter((item) => item.id !== optimisticItem.id)
          )
        }

        const errorMessage =
          error instanceof ApiError
            ? error.message
            : error instanceof AppError
              ? error.message
              : ERROR_MESSAGES.FAILED_TO_ADD

        setVoteFeedback({ message: errorMessage, variant: 'warning' })
      }
    },
    [username, optimisticUpdate]
  )

  const handleVote = useCallback(
    async (queueId: string, voteDirection: 'up' | 'down'): Promise<void> => {
      const VOTE_STORAGE_KEY = `vote_${queueId}`

      // Check if user has already voted on this track
      if (localStorage.getItem(VOTE_STORAGE_KEY)) {
        setVoteFeedback({
          message: 'You have already voted for this track.',
          variant: 'warning'
        })
        return
      }

      // Set pending vote flag and check if already pending (prevents concurrent requests)
      let isAlreadyPending = false
      setPendingVoteIds((prev) => {
        if (prev[queueId]) {
          isAlreadyPending = true
          return prev
        }
        return {
          ...prev,
          [queueId]: true
        }
      })

      if (isAlreadyPending) {
        return
      }

      // Optimistic update - update vote count immediately
      if (optimisticUpdate) {
        optimisticUpdate((currentQueue) => {
          const updatedQueue = currentQueue.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  votes: item.votes + (voteDirection === 'up' ? 1 : -1)
                }
              : item
          )

          return sortQueueByPriority(updatedQueue)
        })
      }

      try {
        await sendApiRequest<void>({
          path: '/queue/vote',
          method: 'POST',
          isLocalApi: true,
          body: { queueId, voteDirection }
        })

        // Set localStorage flag only after successful vote to prevent double-voting
        localStorage.setItem(VOTE_STORAGE_KEY, 'true')
        setVoteFeedback({ message: 'Vote recorded!', variant: 'success' })

        // Real-time subscription will handle the update, but we can trigger a refresh
        // to ensure we have the latest data
        void refreshQueue()
      } catch (error: unknown) {
        // Revert optimistic update on error
        if (optimisticUpdate) {
          optimisticUpdate((currentQueue) => {
            const updatedQueue = currentQueue.map((item) =>
              item.id === queueId
                ? {
                    ...item,
                    votes: item.votes + (voteDirection === 'up' ? -1 : 1)
                  }
                : item
            )

            return updatedQueue.sort((a, b) => {
              if (b.votes !== a.votes) return b.votes - a.votes

              const aTime = new Date(a.queued_at).getTime()
              const bTime = new Date(b.queued_at).getTime()

              return aTime - bTime
            })
          })
        }

        // If optimistic update was used, the real-time subscription will correct the state
        const errorMessage =
          error instanceof ApiError || error instanceof Error
            ? error.message
            : 'Failed to cast vote.'

        setVoteFeedback({
          message: errorMessage,
          variant: 'warning'
        })
        handleApiError(error, 'VoteError')
      } finally {
        setPendingVoteIds((prev) => {
          return Object.fromEntries(
            Object.entries(prev).filter(([key]) => key !== queueId)
          )
        })
      }
    },
    [refreshQueue, optimisticUpdate]
  )

  // Type guard for error with message
  function hasErrorMessage(error: unknown): error is { message: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message: unknown }).message === 'string'
    )
  }

  if (playlistError && (!queue || queue.length === 0)) {
    const errorMessage = hasErrorMessage(playlistError)
      ? playlistError.message
      : 'An unknown error occurred while fetching the playlist.'
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <ErrorMessage
            message={errorMessage}
            variant='error'
            className='text-center'
          />
        </div>
      </div>
    )
  }

  if (!queue) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <ErrorMessage
            message='Playlist not found'
            variant='error'
            className='text-center'
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className='min-h-screen w-full'
      style={{
        backgroundColor: '#000000',
        color: '#ffffff',
        fontFamily: 'Belgrano'
      }}
    >
      <AutoFillNotification />
      {lastAddedTrack && (
        <Toast
          message={`"${lastAddedTrack.name}" added to playlist`}
          onDismiss={() => setLastAddedTrack(null)}
          variant='success'
          autoDismissMs={3000}
        />
      )}
      {voteFeedback && (
        <Toast
          message={voteFeedback.message}
          onDismiss={() => setVoteFeedback(null)}
          variant={voteFeedback.variant}
          autoDismissMs={3000}
        />
      )}

      {/* Offline/Error Warning Banner */}
      {playlistError && queue && queue.length > 0 && (
        <div className='text-white fixed left-0 right-0 top-0 z-50 flex items-center justify-center bg-yellow-600/90 px-4 py-2 backdrop-blur-sm'>
          <p className='text-center text-sm font-medium'>
            {hasErrorMessage(playlistError)
              ? playlistError.message
              : 'Connection issue'}{' '}
            - Showing cached playlist
          </p>
        </div>
      )}

      {/* Header */}
      <div className='mx-auto flex w-full flex-col items-center justify-center space-y-4 p-4 sm:w-10/12 md:w-8/12 lg:w-9/12'>
        <div className='mx-auto flex w-full overflow-hidden sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <div className='relative flex aspect-[32/9] w-full items-center justify-center overflow-hidden'>
            <Image
              src='/logo.png'
              alt='Venue Logo'
              fill
              className='object-contain'
              sizes='(max-width: 640px) 100vw, (max-width: 768px) 83.333333vw, (max-width: 1024px) 66.666667vw, 75vw'
            />
          </div>
        </div>

        <div className='text-center'>
          <h1
            style={{
              fontFamily: 'Belgrano',
              fontSize: '2.25rem',
              fontWeight: 'normal',
              color: '#ffffff'
            }}
          >
            3B Jukebox
          </h1>
        </div>
      </div>

      {/* Search Input */}
      <div className='mx-auto flex w-full flex-col space-y-6 p-4 sm:w-10/12 md:w-8/12 lg:w-9/12'>
        <div
          className='mx-auto flex w-full overflow-hidden rounded-lg shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'
          style={{ backgroundColor: '#C09A5E' }}
        >
          <div className='flex w-full flex-col p-5'>
            <SearchInput
              onAddTrack={handleAddTrack}
              username={username}
              currentQueue={queue || []}
              textColor='#000000'
              secondaryColor='#6b7280'
              accentColor1='#d1d5db'
              accentColor3='#f3f4f6'
            />
          </div>
        </div>
        <Suspense fallback={<PlaylistSkeleton />}>
          <div className='relative'>
            <Playlist
              tracks={queue || []}
              currentlyPlaying={currentlyPlaying}
              artistExtract={extract}
              isExtractLoading={isExtractLoading}
              extractError={extractError}
              onVote={(queueId, voteDirection) => {
                void handleVote(queueId, voteDirection)
              }}
              isRefreshing={isPlaylistRefreshing}
              pendingVotes={pendingVoteIds}
              highlightSpotifyTrackId={lastAddedTrack?.id ?? null}
              primaryColor='#C09A5E'
              textColor='#000000'
              secondaryColor='#6b7280'
              accentColor2='#6b7280'
              accentColor1='#d1d5db'
              accentColor3='#f3f4f6'
              username={username}
            />
          </div>
        </Suspense>
      </div>
    </div>
  )
}
