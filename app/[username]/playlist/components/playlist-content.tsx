'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useUserToken } from '@/hooks/useUserToken'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { useArtistExtract } from '@/hooks/useArtistExtract'
import { usePlaylistData } from '@/hooks/usePlaylistData'
import { TrackDetails } from '@/shared/types/spotify'
import SearchInput from '@/components/SearchInput'
import Playlist from '@/components/Playlist/Playlist'
import { AppError, handleApiError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { Loading, PlaylistSkeleton, ErrorMessage, Toast } from '@/components/ui'

type VoteFeedback = {
  message: string
  variant: 'success' | 'warning'
}

type PlaylistContentProps = {
  username: string
}

export default function PlaylistContent({
  username
}: PlaylistContentProps): JSX.Element {
  const [voteFeedback, setVoteFeedback] = useState<VoteFeedback | null>(null)

  const {
    token,
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
    mutate: refreshQueue
  } = usePlaylistData(username)

  const { data: currentlyPlaying } = useNowPlayingTrack({
    token,
    enabled: !isTokenLoading && !!token
  })

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
          throw new AppError(
            ERROR_MESSAGES.FAILED_TO_ADD,
            response.status,
            'PlaylistPage'
          )
        }

        setLastAddedTrack(track)
        void refreshQueue()
      } catch (error: unknown) {
        const appError = handleApiError(error, 'PlaylistPage')
        if (appError instanceof AppError) {
          setVoteFeedback({ message: appError.message, variant: 'warning' })
        }
      }
    },
    [username, refreshQueue]
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

      try {
        const response = await fetch('/api/queue/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueId, voteDirection })
        })

        if (!response.ok) {
          throw new Error('Failed to cast vote.')
        }

        localStorage.setItem(VOTE_STORAGE_KEY, 'true')
        setVoteFeedback({ message: 'Vote recorded!', variant: 'success' })
        void refreshQueue()
      } catch (error: unknown) {
        if (error instanceof Error) {
          setVoteFeedback({
            message: error.message,
            variant: 'warning'
          })
        }
        handleApiError(error, 'VoteError')
      }
    },
    [refreshQueue]
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
            <SearchInput onAddTrack={handleAddTrack} username={username} />
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
              username={username}
            />
          </div>
        </Suspense>
      </div>
    </div>
  )
}
