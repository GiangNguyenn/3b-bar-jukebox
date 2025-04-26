'use client'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useEffect, useState, useMemo, memo, useCallback } from 'react'
import { useSearchTracks } from '../hooks/useSearchTracks'
import Playlist from '@/components/Playlist/Playlist'
import Loading from './loading'
import SearchInput from '@/components/SearchInput'
import { useDebounce } from 'use-debounce'
import { SpotifySearchRequest } from '@/hooks/useSearchTracks'
import { TrackDetails } from '@/shared/types'
import { useMyPlaylists } from '@/hooks/useMyPlaylists'

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

const Home = memo((): JSX.Element => {
  const {
    fixedPlaylistId,
    isLoading: isCreatingPlaylist,
    isInitialFetchComplete
  } = useFixedPlaylist()
  const { playlist, refreshPlaylist } = usePlaylist(fixedPlaylistId ?? '')
  const { refetchPlaylists } = useMyPlaylists()
  const [searchQuery, setSearchQuery] = useState('')
  const { searchTracks, tracks: searchResults } = useSearchTracks()

  useEffect(() => {
    if (!fixedPlaylistId && isInitialFetchComplete) {
      console.error('[Fixed Playlist] Required playlist not found: 3B Saigon')
    }
  }, [fixedPlaylistId, isInitialFetchComplete])

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

  if (isCreatingPlaylist || !playlist || !fixedPlaylistId) {
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

Home.displayName = 'Home'

export default Home
