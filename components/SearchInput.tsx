'use client'

import { useState } from 'react'
import { TrackDetails } from '@/shared/types'
import { handleApiError } from '@/shared/utils/errorHandling'
import Image from 'next/image'

interface SearchInputProps {
  onAddTrack: (track: TrackDetails) => Promise<void>
}

interface SearchResponse {
  tracks?: {
    items: TrackDetails[]
  }
}

export default function SearchInput({
  onAddTrack
}: SearchInputProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async (): Promise<void> => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}`
      )
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

  const handleKeyPress = (
    event: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key === 'Enter') {
      void handleSearch()
    }
  }

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
          onKeyPress={handleKeyPress}
          placeholder='Search for a song...'
          className='w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none'
        />
        <button
          onClick={() => void handleSearch()}
          disabled={isSearching}
          className='text-white absolute right-2 top-1/2 -translate-y-1/2 rounded bg-blue-500 px-4 py-1 hover:bg-blue-600 disabled:bg-gray-400'
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <div className='mt-2 text-red-500'>{error}</div>}

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
    </div>
  )
}
