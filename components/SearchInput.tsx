import { TrackDetails, TrackItem } from '@/shared/types'
import { FC, useState, useCallback, useEffect } from 'react'
import { faSearch } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useAddTrackToPlaylist } from '@/hooks/useAddTrackToPlaylist'
import Image from 'next/image'
import { useSearchTracks } from '@/hooks/useSearchTracks'
import { AppError } from '@/shared/utils/errorHandling'
import { handleApiError } from '@/shared/utils/errorHandling'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'

interface SearchInputProps {
  onAddTrack: (track: TrackDetails) => Promise<void>
}

const SearchInput: FC<SearchInputProps> = ({ onAddTrack }): JSX.Element => {
  const { fixedPlaylistId } = useFixedPlaylist()
  const { addTrack } = useAddTrackToPlaylist({
    playlistId: fixedPlaylistId ?? ''
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const { searchTracks, tracks, setTracks, isLoading, error } =
    useSearchTracks()

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        searchTracks({ query: searchQuery })
      } else {
        setTracks([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, searchTracks, setTracks])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    setIsDropdownOpen(true)
  }, [])

  const handleAddTrack = useCallback(
    async (track: TrackDetails) => {
      try {
        await onAddTrack(track)
        setSearchQuery('')
        setTracks([])
        setIsDropdownOpen(false)
      } catch (error) {
        console.error('[SearchInput] Error adding track:', error)
        const appError = handleApiError(error, 'SearchInput')
        // You might want to show this error to the user
      }
    },
    [onAddTrack, setTracks]
  )

  return (
    <div className='w-full'>
      <div className='mx-auto flex w-full overflow-visible rounded-lg bg-primary-100 shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'>
        <div className='flex w-full flex-col p-5'>
          <div className='relative flex-1'>
            <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3'>
              <FontAwesomeIcon icon={faSearch} className='text-gray-400' />
            </div>
            <input
              type='text'
              value={searchQuery}
              onChange={handleChange}
              placeholder='Search for a song...'
              className='bg-white block w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 leading-5 placeholder-gray-500 focus:border-blue-500 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm'
              aria-label='Search for songs, albums, or artists'
            />
            {isDropdownOpen && (searchQuery || tracks.length > 0) && (
              <div
                className='absolute z-50 mt-1 w-full rounded-lg border shadow-lg'
                style={{ backgroundColor: '#ffffff' }}
              >
                {isLoading ? (
                  <div
                    className='p-4 text-center'
                    style={{ backgroundColor: '#ffffff' }}
                  >
                    Loading...
                  </div>
                ) : error ? (
                  <div
                    className='p-4 text-center text-red-500'
                    style={{ backgroundColor: '#ffffff' }}
                  >
                    {error.message}
                  </div>
                ) : tracks.length > 0 ? (
                  <ul
                    className='max-h-60 overflow-auto'
                    style={{ backgroundColor: '#ffffff' }}
                  >
                    {tracks.map((track) => (
                      <li
                        key={track.id}
                        className='flex cursor-pointer items-center p-2 transition-colors duration-150'
                        style={{ backgroundColor: '#ffffff' }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = '#f3f4f6')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = '#ffffff')
                        }
                        onClick={() => handleAddTrack(track)}
                      >
                        <img
                          src={track.album.images[0]?.url}
                          alt={track.album.name}
                          className='mr-3 h-10 w-10 rounded'
                        />
                        <div style={{ backgroundColor: 'transparent' }}>
                          <div
                            className='font-medium'
                            style={{ backgroundColor: 'transparent' }}
                          >
                            {track.name}
                          </div>
                          <div
                            className='text-sm text-gray-500'
                            style={{ backgroundColor: 'transparent' }}
                          >
                            {track.artists
                              .map((artist) => artist.name)
                              .join(', ')}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div
                    className='p-4 text-center text-gray-500'
                    style={{ backgroundColor: '#ffffff' }}
                  >
                    No results found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SearchInput
