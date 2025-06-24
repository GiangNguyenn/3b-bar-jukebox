'use client'

import { useState, useEffect, useRef } from 'react'
import { TrackDetails } from '@/shared/types/spotify'
import { handleApiError } from '@/shared/utils/errorHandling'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui/loading'
import Image from 'next/image'

interface SearchInputProps {
  onAddTrack: (track: TrackDetails) => Promise<void>
  username?: string
}

interface SearchResponse {
  tracks?: {
    items: TrackDetails[]
  }
}

export default function SearchInput({
  onAddTrack,
  username
}: SearchInputProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const handleSearch = async (query: string): Promise<void> => {
    if (!query.trim() || query.trim().length < 3) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    setError(null)

    try {
      const searchParams = new URLSearchParams({
        q: query
      })

      if (username) {
        searchParams.append('username', username)
      }

      const response = await fetch(`/api/search?${searchParams.toString()}`)
      if (!response.ok) {
        throw new Error('Search failed')
      }
      const data = (await response.json()) as SearchResponse
      setSearchResults(data.tracks?.items ?? [])
    } catch (error) {
      console.error('[SearchInput] Error searching tracks:', error)
      const appError = handleApiError(error, 'SearchInput')
      setError(appError.message)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

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
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [searchQuery, username])

  const handleAddTrack = async (track: TrackDetails): Promise<void> => {
    try {
      await onAddTrack(track)
      setSearchResults([])
      setSearchQuery('')
    } catch (error) {
      console.error('[SearchInput] Error adding track:', error)
      const appError = handleApiError(error, 'SearchInput')
      setError(appError.message)
    }
  }

  return (
    <div className='w-full'>
      <div className='relative'>
        <input
          type='text'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder='Search for a song... (type at least 3 characters)'
          className='w-full rounded-lg border border-gray-300 p-2 pr-4 focus:border-blue-500 focus:outline-none'
        />
        {isSearching && (
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
          {searchResults.map((track) => (
            <div
              key={track.id}
              className='flex cursor-pointer items-center space-x-4 border-b border-gray-200 p-4 hover:bg-gray-50'
              onClick={() => void handleAddTrack(track)}
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
              <div>
                <div className='font-medium'>{track.name}</div>
                <div className='text-sm text-gray-500'>
                  {track.artists.map((artist) => artist.name).join(', ')}
                </div>
              </div>
            </div>
          ))}
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
