'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { TrackDetails } from '@/shared/types/spotify'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { handleApiError } from '@/shared/utils/errorHandling'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui/loading'
import Image from 'next/image'

interface SearchInputProps {
  onAddTrack: (track: TrackDetails) => Promise<void>
  username?: string
  currentQueue?: JukeboxQueueItem[]
}

interface SearchResponse {
  tracks?: {
    items: TrackDetails[]
  }
}

export default function SearchInput({
  onAddTrack,
  username,
  currentQueue = []
}: SearchInputProps): JSX.Element {
  const { addLog } = useConsoleLogsContext()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAddingTrack, setIsAddingTrack] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Check if a track already exists in the queue
  const isTrackInQueue = useCallback(
    (trackId: string): boolean => {
      return currentQueue.some(
        (item) => item.tracks.spotify_track_id === trackId
      )
    },
    [currentQueue]
  )

  const handleSearch = useCallback(
    async (query: string): Promise<void> => {
      if (!query.trim() || query.trim().length < 3) {
        setSearchResults([])
        return
      }

      // Abort previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      // Create a new AbortController for the new request
      const controller = new AbortController()
      abortControllerRef.current = controller

      setIsSearching(true)
      setError(null)

      try {
        const searchParams = new URLSearchParams({
          q: query
        })

        if (username) {
          searchParams.append('username', username)
        }

        const response = await fetch(`/api/search?${searchParams.toString()}`, {
          signal: controller.signal
        })
        if (!response.ok) {
          throw new Error('Search failed')
        }
        const data = (await response.json()) as SearchResponse
        setSearchResults(data.tracks?.items ?? [])
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          addLog('INFO', 'Search request aborted', 'SearchInput')
          return // Don't set error for aborted requests
        }
        addLog('ERROR', 'Error searching tracks', 'SearchInput', error as Error)
        const appError = handleApiError(error, 'SearchInput')
        setError(appError.message)
        setSearchResults([])
      } finally {
        // Only set searching to false if the current request was not aborted
        if (!controller.signal.aborted) {
          setIsSearching(false)
        }
      }
    },
    [username, addLog]
  )

  // Debounced search effect
  useEffect(() => {
    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Only search if query has 3+ characters
    if (searchQuery.trim().length >= 3) {
      // Debounce search by 300ms
      debounceRef.current = setTimeout(() => {
        void handleSearch(searchQuery)
      }, 300)
    } else {
      // Clear results if query is too short
      setSearchResults([])
    }

    // Cleanup timeout on unmount or when searchQuery changes
    return (): void => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      // Abort any ongoing search when the component unmounts or query changes
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [searchQuery, username, handleSearch])

  const handleAddTrack = useCallback(
    async (track: TrackDetails): Promise<void> => {
      // Check if track is already in queue
      if (isTrackInQueue(track.id)) {
        setError('This track is already in the playlist')
        return
      }

      try {
        setIsAddingTrack(true)
        setSearchResults([])
        setSearchQuery('')
        await onAddTrack(track)
        setIsAddingTrack(false)
      } catch (error) {
        addLog('ERROR', 'Error adding track', 'SearchInput', error as Error)
        const appError = handleApiError(error, 'SearchInput')
        setError(appError.message)
      }
    },
    [onAddTrack, addLog, isTrackInQueue]
  )

  return (
    <div className='w-full'>
      <div className='relative'>
        <input
          type='text'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder='Search for a song... (type at least 3 characters)'
          className='w-full rounded-lg border border-gray-300 p-2 pr-4 focus:border-blue-500 focus:outline-none'
          disabled={isAddingTrack}
        />
        {(isSearching || isAddingTrack) && (
          <div className='absolute right-3 top-1/2 -translate-y-1/2'>
            <Loading className='h-4 w-4' />
          </div>
        )}
      </div>

      {error && (
        <ErrorMessage
          message={error}
          onDismiss={() => setError(null)}
          className='mt-2'
        />
      )}

      {searchResults.length > 0 && (
        <div className='mt-4 max-h-96 overflow-y-auto rounded-lg border border-gray-200'>
          {searchResults.map((track) => {
            const isDuplicate = isTrackInQueue(track.id)
            return (
              <div
                key={track.id}
                className={`flex cursor-pointer items-center space-x-4 border-b border-gray-200 p-4 ${
                  isDuplicate
                    ? 'cursor-not-allowed bg-gray-100 opacity-60'
                    : 'hover:bg-gray-50'
                }`}
                onClick={() => !isDuplicate && void handleAddTrack(track)}
              >
                {track.album.images[0] && (
                  <Image
                    src={track.album.images[0].url}
                    alt={track.album.name}
                    width={48}
                    height={48}
                    className='rounded'
                  />
                )}
                <div className='flex-1'>
                  <div className='font-medium'>{track.name}</div>
                  <div className='text-sm text-gray-500'>
                    {track.artists.map((artist) => artist.name).join(', ')}
                  </div>
                  {isDuplicate && (
                    <div className='mt-1 text-xs text-red-500'>
                      Already in playlist
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
        <div className='mt-2 text-sm text-gray-500'>
          Type at least 3 characters to search...
        </div>
      )}
    </div>
  )
}
