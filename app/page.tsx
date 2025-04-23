'use client'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useEffect, useState, useMemo, memo, useCallback } from 'react'
import { useSearchTracks } from '../hooks/useSearchTracks'
import Playlist from '@/components/Playlist/Playlist'
import Loading from './loading'
import SearchInput from '@/components/SearchInput'
import { useDebounce } from 'use-debounce'
import { FALLBACK_GENRES } from '@/shared/constants/trackSuggestion'
import { SpotifySearchRequest } from '@/hooks/useSearchTracks'
import { TrackDetails } from '@/shared/types'

const STORAGE_KEY = 'track-suggestions-state'

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

interface TrackSuggestionsState {
  genres: string[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  songsBetweenRepeats: number
}

const getTrackSuggestionsState = (): TrackSuggestionsState => {
  if (typeof window === 'undefined') {
    return {
      genres: Array.from(FALLBACK_GENRES),
      yearRange: [1950, new Date().getFullYear()],
      popularity: 50,
      allowExplicit: false,
      maxSongLength: 20,
      songsBetweenRepeats: 20
    }
  }

  const savedState = localStorage.getItem(STORAGE_KEY)

  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as Partial<TrackSuggestionsState>
      return {
        genres:
          Array.isArray(parsed.genres) && parsed.genres.length > 0
            ? parsed.genres
            : Array.from(FALLBACK_GENRES),
        yearRange: parsed.yearRange ?? [1950, new Date().getFullYear()],
        popularity: parsed.popularity ?? 50,
        allowExplicit: parsed.allowExplicit ?? false,
        maxSongLength: parsed.maxSongLength ?? 20,
        songsBetweenRepeats: parsed.songsBetweenRepeats ?? 20
      }
    } catch (error) {
      console.error(
        '[PARAM CHAIN] Failed to parse localStorage in getTrackSuggestionsState (page.tsx):',
        error
      )
      // If parsing fails, return default state
    }
  }

  return {
    genres: Array.from(FALLBACK_GENRES),
    yearRange: [1950, new Date().getFullYear()],
    popularity: 50,
    allowExplicit: false,
    maxSongLength: 20,
    songsBetweenRepeats: 20
  }
}

const Home = memo((): JSX.Element => {
  const {
    fixedPlaylistId,
    isLoading: isCreatingPlaylist,
    isInitialFetchComplete
  } = useFixedPlaylist()
  const { playlist, refreshPlaylist } = usePlaylist(fixedPlaylistId ?? '')
  const [searchQuery, setSearchQuery] = useState('')
  const { searchTracks, tracks: searchResults } = useSearchTracks()

  useEffect(() => {
    if (!fixedPlaylistId && isInitialFetchComplete) {
      console.error('[Fixed Playlist] Required playlist not found: 3B Saigon')
    }
  }, [fixedPlaylistId, isInitialFetchComplete])

  const handleTrackAdded = useCallback((): void => {
    const trackSuggestionsState = getTrackSuggestionsState()
    void refreshPlaylist(trackSuggestionsState)
  }, [refreshPlaylist])

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
