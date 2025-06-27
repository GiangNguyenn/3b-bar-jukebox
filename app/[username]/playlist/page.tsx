'use client'

import { Suspense, useMemo, useEffect, useState, useCallback } from 'react'
import { useGetPlaylist } from '@/hooks/useGetPlaylist'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useTrackOperations } from '@/hooks/useTrackOperations'
import { useUserToken } from '@/hooks/useUserToken'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { useUpcomingTracks } from '@/hooks/useUpcomingTracks'
import { TrackDetails, TrackItem } from '@/shared/types/spotify'
import SearchInput from '@/components/SearchInput'
import Playlist from '@/components/Playlist/Playlist'
import { handleApiError } from '@/shared/utils/errorHandling'
import { AppError } from '@/shared/utils/errorHandling'
import { useParams } from 'next/navigation'
import { Loading, PlaylistSkeleton, ErrorMessage, Toast } from '@/components/ui'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

export default function PlaylistPage(): JSX.Element {
  const params = useParams()
  const username = params?.username as string | undefined

  const {
    token,
    loading: isTokenLoading,
    error: tokenError,
    isRecovering,
    isJukeboxOffline,
    fetchToken
  } = useUserToken()

  const { fixedPlaylistId, isLoading: isPlaylistIdLoading } = useFixedPlaylist()

  // Only enable useGetPlaylist when we have both token and playlistId, and token is not loading
  const shouldEnablePlaylist = !isTokenLoading && !!token && !!fixedPlaylistId

  const {
    data: playlist,
    error: playlistError,
    isLoading: isPlaylistLoading,
    isRefreshing: isPlaylistRefreshing,
    refetch: refetchPlaylist
  } = useGetPlaylist({
    playlistId: fixedPlaylistId,
    token,
    enabled: shouldEnablePlaylist
  }) as {
    data: { tracks: { items: TrackItem[] } } | null
    error: string | null
    isLoading: boolean
    isRefreshing: boolean
    refetch: () => Promise<void>
  }

  const { addTrack, optimisticTracks, lastAddedTrack, clearLastAddedTrack } =
    useTrackOperations({
      playlistId: fixedPlaylistId ?? '',
      token
    }) as {
      addTrack: (track: TrackItem) => Promise<void>
      optimisticTracks: TrackItem[]
      lastAddedTrack: TrackItem | null
      clearLastAddedTrack: () => void
    }

  // Get currently playing track using the user's token
  const { data: currentlyPlaying } = useNowPlayingTrack({
    token,
    enabled: !isTokenLoading && !!token
  })

  // Get only the upcoming tracks (tracks that are yet to be played)
  const upcomingTracks = useUpcomingTracks(
    playlist ?? undefined,
    currentlyPlaying ?? undefined
  )

  // Include optimistic track in the display if it exists
  const tracksToDisplay = useMemo(() => {
    if (optimisticTracks.length === 0) {
      return upcomingTracks
    }

    // Always add optimistic tracks to the end of the list
    return [...upcomingTracks, ...optimisticTracks]
  }, [upcomingTracks, optimisticTracks])

  const handleAddTrack = async (track: TrackDetails): Promise<void> => {
    try {
      const trackItem: TrackItem = {
        added_at: new Date().toISOString(),
        added_by: {
          id: 'user',
          type: 'user',
          uri: 'spotify:user:user',
          href: 'https://api.spotify.com/v1/users/user',
          external_urls: {
            spotify: 'https://open.spotify.com/user/user'
          }
        },
        is_local: false,
        track
      }
      await addTrack(trackItem)
    } catch (error) {
      const appError = handleApiError(error, 'PlaylistPage')
      if (appError instanceof AppError) {
        // Error is already handled by handleApiError
      }
    }
  }

  const [isTokenInvalid, setIsTokenInvalid] = useState(false)

  // Effect to handle token recovery
  useEffect(() => {
    if (playlistError === 'Token invalid' && !isRecovering) {
      setIsTokenInvalid(true)
    }
  }, [playlistError, isRecovering])

  const handleTokenRecovery = useCallback(async () => {
    if (fetchToken) {
      const newToken = await fetchToken()
      if (newToken) {
        setIsTokenInvalid(false)
        // Manually trigger a refetch of the playlist with the new token
        void refetchPlaylist()
      }
    }
  }, [fetchToken, refetchPlaylist])

  useEffect(() => {
    if (isTokenInvalid) {
      void handleTokenRecovery()
    }
  }, [isTokenInvalid, handleTokenRecovery])

  // Reload page when jukebox goes offline (can't recover from expired token)
  useEffect(() => {
    if (isJukeboxOffline) {
      // Small delay to ensure the user sees the loading state briefly
      const reloadTimer = setTimeout(() => {
        window.location.reload()
      }, 1000)

      return (): void => clearTimeout(reloadTimer)
    }

    // Return empty cleanup function when not offline
    return (): void => {}
  }, [isJukeboxOffline])

  // Show jukebox offline state if circuit breaker is open
  if (isJukeboxOffline) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <Loading fullScreen message='Reconnecting to jukebox...' />
        </div>
      </div>
    )
  }

  // Show token error if present
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

  // Show playlist error if present
  if (playlistError) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <ErrorMessage
            message={playlistError}
            variant='error'
            className='text-center'
          />
        </div>
      </div>
    )
  }

  // Show loading state during token loading or recovery
  if (
    isTokenLoading ||
    isPlaylistIdLoading ||
    isPlaylistLoading ||
    isRecovering ||
    isTokenInvalid
  ) {
    return (
      <Loading
        fullScreen
        message={isRecovering ? ERROR_MESSAGES.RECONNECTING : 'Loading...'}
      />
    )
  }

  if (!playlist) {
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
      {/* Success Toast */}
      {lastAddedTrack && (
        <Toast
          message={`"${lastAddedTrack.track.name}" added to playlist`}
          onDismiss={clearLastAddedTrack}
          variant='success'
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
            {isPlaylistRefreshing && (
              <div className='bg-white absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-opacity-75'>
                <Loading className='h-6 w-6' message='Refreshing...' />
              </div>
            )}
            <Playlist
              tracks={tracksToDisplay}
              optimisticTracks={optimisticTracks}
              currentlyPlaying={currentlyPlaying}
            />
          </div>
        </Suspense>
      </div>
    </div>
  )
}
