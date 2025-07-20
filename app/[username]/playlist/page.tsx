'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useUserToken } from '@/hooks/useUserToken'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
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
import { Loading, PlaylistSkeleton, ErrorMessage, Toast } from '@/components/ui'
import { AutoFillNotification } from '@/components/ui/auto-fill-notification'

type VoteFeedback = {
  message: string
  variant: 'success' | 'warning'
}

export default function PlaylistPage(): JSX.Element {
  const params = useParams()
  const username = params?.username as string | undefined
  const [voteFeedback, setVoteFeedback] = useState<VoteFeedback | null>(null)

  const {
    loading: isTokenLoading,
    error: tokenError,
    isRecovering,
    isJukeboxOffline,
    fetchToken
  } = useUserToken()

  const {
    data: queue,
    error: playlistError,
    isLoading: isPlaylistLoading,
    isRefreshing: isPlaylistRefreshing,
    mutate: refreshQueue,
    optimisticUpdate
  } = usePlaylistData(username)

  const { data: currentlyPlaying } = useNowPlayingTrack({
    token: null, // Don't use user token for public pages
    enabled: true, // Always enabled for public pages
    refetchInterval: 5000 // Poll every 5 seconds for more responsive updates
  })

  // Force refresh queue when currently playing track changes
  useEffect(() => {
    if (currentlyPlaying?.item?.id) {
      // Refresh queue to update the currently playing indicator
      void refreshQueue()
    }
  }, [currentlyPlaying?.item?.id, currentlyPlaying?.item?.name, refreshQueue])

  const artistName = currentlyPlaying?.item?.artists[0]?.name
  const {
    data: extract,
    isLoading: isExtractLoading,
    error: extractError
  } = useArtistExtract(artistName)

  const [lastAddedTrack, setLastAddedTrack] = useState<TrackDetails | null>(
    null
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

      // Optimistically add the track to the queue
      if (optimisticUpdate && queue) {
        optimisticUpdate((currentQueue) => [optimisticItem, ...currentQueue])
      }

      try {
        const response = await fetch(`/api/playlist/${username}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracks: track,
            initialVotes: 5,
            source: 'user' // Mark as user-initiated
          })
        })

        if (!response.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
          throw new AppError(
            ERROR_MESSAGES.FAILED_TO_ADD,
            response.status,
            'PlaylistPage'
          )
        }

        setLastAddedTrack(track)
        // The real-time subscription will update the queue with the actual data
        // so we don't need to call refreshQueue() here
      } catch (error: unknown) {
        // Remove the optimistic item on error
        if (optimisticUpdate && queue) {
          optimisticUpdate((currentQueue) =>
            currentQueue.filter((item) => item.id !== optimisticItem.id)
          )
        }

        const appError = handleApiError(error, 'PlaylistPage')
        if (appError instanceof AppError) {
          setVoteFeedback({ message: appError.message, variant: 'warning' })
        }
      }
    },
    [username, optimisticUpdate, queue]
  )

  const handleVote = useCallback(
    async (queueId: string, voteDirection: 'up' | 'down'): Promise<void> => {
      const VOTE_STORAGE_KEY = `vote_${queueId}`
      if (localStorage.getItem(VOTE_STORAGE_KEY)) {
        setVoteFeedback({
          message: 'You have already voted for this track.',
          variant: 'warning'
        })
        return
      }

      // Optimistic update - update vote count immediately
      if (optimisticUpdate && queue) {
        optimisticUpdate((currentQueue) =>
          currentQueue.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  votes: item.votes + (voteDirection === 'up' ? 1 : -1)
                }
              : item
          )
        )
      }

      try {
        const response = await fetch('/api/queue/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueId, voteDirection })
        })

        if (!response.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
          const errorData: { error?: string } = await response.json()
          throw new Error(errorData.error ?? 'Failed to cast vote.')
        }

        localStorage.setItem(VOTE_STORAGE_KEY, 'true')
        setVoteFeedback({ message: 'Vote recorded!', variant: 'success' })

        // Real-time subscription will handle the update, but we can trigger a refresh
        // to ensure we have the latest data
        void refreshQueue()
      } catch (error: unknown) {
        // If optimistic update was used, the real-time subscription will correct the state
        if (error instanceof Error) {
          setVoteFeedback({
            message: error.message,
            variant: 'warning'
          })
        }
        handleApiError(error, 'VoteError')
      }
    },
    [refreshQueue, optimisticUpdate, queue]
  )

  const [isTokenInvalid, setIsTokenInvalid] = useState<boolean>(false)

  useEffect(() => {
    if (
      playlistError &&
      typeof playlistError === 'object' &&
      'message' in playlistError &&
      typeof (playlistError as { message: unknown }).message === 'string' &&
      (playlistError as { message: string }).message.includes(
        'Token invalid'
      ) &&
      !isRecovering
    ) {
      setIsTokenInvalid(true)
    }
  }, [playlistError, isRecovering])

  const handleTokenRecovery = useCallback(async (): Promise<void> => {
    if (fetchToken) {
      const newToken = await fetchToken()
      if (newToken) {
        setIsTokenInvalid(false)
        void refreshQueue()
      }
    }
  }, [fetchToken, refreshQueue])

  useEffect(() => {
    if (isTokenInvalid) {
      void handleTokenRecovery()
    }
  }, [isTokenInvalid, handleTokenRecovery])

  useEffect(() => {
    if (isJukeboxOffline) {
      const reloadTimer = setTimeout(() => {
        window.location.reload()
      }, 1000)
      return (): void => clearTimeout(reloadTimer)
    }
    return (): void => {}
  }, [isJukeboxOffline])

  if (isJukeboxOffline) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <Loading fullScreen message='Reconnecting to jukebox...' />
        </div>
      </div>
    )
  }

  if (tokenError) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <ErrorMessage
            message={tokenError}
            variant='error'
            autoDismissMs={0}
            className='text-center'
          />
        </div>
      </div>
    )
  }

  if (playlistError) {
    const errorMessage =
      playlistError &&
      typeof playlistError === 'object' &&
      'message' in playlistError
        ? (playlistError as { message: string }).message
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

  if (isTokenLoading || isPlaylistLoading || isRecovering || isTokenInvalid) {
    return (
      <Loading
        fullScreen
        message={isRecovering ? ERROR_MESSAGES.RECONNECTING : 'Loading...'}
      />
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
    <div className='w-full'>
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

      <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
        <div className='mx-auto flex w-full overflow-hidden rounded-lg bg-primary-100 shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <div className='flex w-full flex-col p-5'>
            <SearchInput
              onAddTrack={handleAddTrack}
              username={username}
              currentQueue={queue || []}
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
            />
          </div>
        </Suspense>
      </div>
    </div>
  )
}
