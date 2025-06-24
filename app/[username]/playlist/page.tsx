'use client'

import { Suspense } from 'react'
import { useGetPlaylist } from '@/hooks/useGetPlaylist'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useTrackOperations } from '@/hooks/useTrackOperations'
import { useUserToken } from '@/hooks/useUserToken'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { TrackDetails, TrackItem } from '@/shared/types/spotify'
import SearchInput from '@/components/SearchInput'
import Playlist from '@/components/Playlist/Playlist'
import { handleApiError } from '@/shared/utils/errorHandling'
import { AppError } from '@/shared/utils/errorHandling'
import { useParams } from 'next/navigation'
import { Loading, PlaylistSkeleton } from '@/components/ui'

export default function PlaylistPage(): JSX.Element {
  const params = useParams()
  const username = params?.username as string | undefined

  const { token, loading: isTokenLoading, error: tokenError } = useUserToken()
  const { fixedPlaylistId, isLoading: isPlaylistIdLoading } = useFixedPlaylist()

  // Only enable useGetPlaylist when we have both token and playlistId, and token is not loading
  const shouldEnablePlaylist = !isTokenLoading && !!token && !!fixedPlaylistId

  const {
    data: playlist,
    error: playlistError,
    isLoading: isPlaylistLoading,
    isRefreshing: isPlaylistRefreshing
  } = useGetPlaylist({
    playlistId: fixedPlaylistId,
    token,
    enabled: shouldEnablePlaylist
  }) as {
    data: { tracks: { items: TrackItem[] } } | null
    error: string | null
    isLoading: boolean
    isRefreshing: boolean
  }
  const { addTrack, optimisticTrack } = useTrackOperations({
    playlistId: fixedPlaylistId ?? '',
    token
  }) as {
    addTrack: (track: TrackItem) => Promise<void>
    optimisticTrack: TrackItem | undefined
  }

  // Get currently playing track using the user's token
  const { data: currentlyPlaying } = useNowPlayingTrack({
    token,
    enabled: !isTokenLoading && !!token
  })

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
      console.error('[PlaylistPage] Error adding track:', error)
      const appError = handleApiError(error, 'PlaylistPage')
      if (appError instanceof AppError) {
        console.error('[PlaylistPage] AppError:', appError.message)
      }
    }
  }

  if (tokenError) {
    return <div>Error loading user token: {tokenError}</div>
  }

  if (playlistError) {
    return <div>Error loading playlist: {playlistError}</div>
  }

  if (isTokenLoading || isPlaylistIdLoading || isPlaylistLoading) {
    return <Loading fullScreen />
  }

  if (!playlist) {
    return <div>Playlist not found</div>
  }

  return (
    <div className='w-full'>
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
              tracks={playlist.tracks.items}
              optimisticTrack={optimisticTrack}
              currentlyPlaying={currentlyPlaying}
            />
          </div>
        </Suspense>
      </div>
    </div>
  )
}
