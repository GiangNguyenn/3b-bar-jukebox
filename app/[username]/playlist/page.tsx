'use client'

import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useEffect, useState, useMemo, memo, useCallback } from 'react'
import { useSearchTracks } from '@/hooks/useSearchTracks'
import Playlist from '@/components/Playlist/Playlist'
import Loading from '@/app/loading'
import SearchInput from '@/components/SearchInput'
import { useDebounce } from 'use-debounce'
import { SpotifySearchRequest } from '@/hooks/useSearchTracks'
import { TrackDetails } from '@/shared/types'
import { useMyPlaylists } from '@/hooks/useMyPlaylists'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useParams } from 'next/navigation'

interface PlaylistRefreshEvent extends CustomEvent {
  detail: {
    timestamp: number
  }
}

declare global {
  interface WindowEventMap {
    playlistRefresh: PlaylistRefreshEvent
  }
}

const PlaylistPage = memo((): JSX.Element => {
  const params = useParams()
  const username = params?.username as string | undefined
  const supabase = createClientComponentClient()
  const {
    fixedPlaylistId,
    isLoading: isCreatingPlaylist,
    isInitialFetchComplete,
    error: playlistError
  } = useFixedPlaylist()
  const { playlist, refreshPlaylist } = usePlaylist(fixedPlaylistId ?? '')
  const { refetchPlaylists } = useMyPlaylists()
  const [searchQuery, setSearchQuery] = useState('')
  const { searchTracks, tracks: searchResults } = useSearchTracks()
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const handleCreatePlaylist = useCallback(async (): Promise<void> => {
    try {
      setIsCreating(true)
      setCreateError(null)

      const response = await fetch('/api/playlists/create', {
        method: 'POST'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create playlist')
      }

      // Refresh the playlist data
      window.location.reload()
    } catch (error) {
      console.error('[Create Playlist] Error:', error)
      setCreateError(
        error instanceof Error ? error.message : 'Failed to create playlist'
      )
    } finally {
      setIsCreating(false)
    }
  }, [])

  const handleTrackAdded = useCallback((): void => {
    // Force a revalidation with fresh data
    void refreshPlaylist()
    // Dispatch a custom event to force immediate UI update
    window.dispatchEvent(
      new CustomEvent('playlistRefresh', {
        detail: { timestamp: Date.now() }
      })
    )
    // Force a refresh of the playlists data
    void refetchPlaylists()
  }, [refreshPlaylist, refetchPlaylists])

  const [debouncedSearchQuery] = useDebounce(searchQuery, 300)

  const handleSearch = useCallback(
    async (query: string): Promise<void> => {
      if (!query.trim()) {
        return
      }

      const searchRequest: SpotifySearchRequest = {
        query,
        type: 'track',
        limit: 20
      }

      await searchTracks(searchRequest)
    },
    [searchTracks]
  )

  useEffect(() => {
    const searchTrackDebounce = async (): Promise<void> => {
      try {
        if (debouncedSearchQuery !== '') {
          await handleSearch(debouncedSearchQuery)
        }
      } catch (error) {
        console.error('[Search] Error searching tracks:', error)
      }
    }

    void searchTrackDebounce()
  }, [debouncedSearchQuery, handleSearch])

  const searchInputProps = useMemo<{
    searchQuery: string
    setSearchQuery: (query: string) => void
    searchResults: TrackDetails[]
    setSearchResults: () => void
    playlistId: string
    onTrackAdded: () => void
  }>(
    () => ({
      searchQuery,
      setSearchQuery,
      searchResults,
      setSearchResults: (): void => {}, // This is handled by useSearchTracks now
      playlistId: fixedPlaylistId ?? '',
      onTrackAdded: handleTrackAdded
    }),
    [searchQuery, searchResults, fixedPlaylistId, handleTrackAdded]
  )

  // Show loading state while initial data is being fetched
  if (!isInitialFetchComplete || isCreatingPlaylist) {
    return <Loading />
  }

  // Show error if username is missing
  if (!username) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center p-4'>
        <h1 className='mb-4 text-2xl font-bold text-red-500'>
          Invalid Playlist URL
        </h1>
        <p className='text-center'>
          Please provide a valid username in the URL.
        </p>
      </div>
    )
  }

  // Show error if playlist is not found
  if (playlistError || !fixedPlaylistId) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center p-4'>
        <h1 className='mb-4 text-2xl font-bold text-red-500'>
          Playlist Not Found
        </h1>
        <p className='mb-4 text-center'>
          Could not find a playlist for user: {username}
        </p>
        <button
          onClick={() => void handleCreatePlaylist()}
          disabled={isCreating}
          className='text-white rounded bg-blue-500 px-4 py-2 hover:bg-blue-600 disabled:opacity-50'
        >
          {isCreating ? 'Creating...' : 'Create Playlist'}
        </button>
        {createError && (
          <p className='mt-4 text-center text-red-500'>{createError}</p>
        )}
      </div>
    )
  }

  // Show loading state while playlist data is being fetched
  if (!playlist) {
    return <Loading />
  }

  const { tracks } = playlist

  return (
    <div className='items-center justify-items-center space-y-3 p-4 pt-10 font-mono'>
      <SearchInput {...searchInputProps} />
      <Playlist tracks={tracks.items} />
    </div>
  )
})

PlaylistPage.displayName = 'PlaylistPage'

export default PlaylistPage
