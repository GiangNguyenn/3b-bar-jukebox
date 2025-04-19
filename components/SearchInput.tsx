import { TrackDetails, TrackItem } from '@/shared/types'
import { FC, useState } from 'react'
import { faSearch } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useAddTrackToPlaylist } from '@/hooks/useAddTrackToPlaylist'
import Image from 'next/image'

interface SearchInputProps {
  searchQuery: string
  setSearchQuery: (value: string) => void
  searchResults: TrackDetails[]
  setSearchResults: (value: TrackDetails[]) => void
  playlistId: string
  onTrackAdded?: () => void
}

const SearchInput: FC<SearchInputProps> = ({
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
  playlistId,
  onTrackAdded
}): JSX.Element => {
  const { addTrack } = useAddTrackToPlaylist({ playlistId })
  const [isOpen, setIsOpen] = useState(false)

  const handleChange = (value: string): void => {
    setSearchQuery(value)
    setIsOpen(true)
  }

  const handleAddTrack = (track: TrackDetails): void => {
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
      track: {
        uri: track.uri,
        name: track.name,
        artists: track.artists,
        album: track.album,
        duration_ms: track.duration_ms,
        id: track.id,
        available_markets: track.available_markets,
        disc_number: track.disc_number,
        explicit: track.explicit,
        external_ids: track.external_ids,
        external_urls: track.external_urls,
        href: track.href,
        is_local: track.is_local,
        is_playable: track.is_playable,
        popularity: track.popularity,
        preview_url: track.preview_url,
        track_number: track.track_number,
        type: track.type
      }
    }

    void addTrack(trackItem)
      .then(() => {
        // Clear search results and close dropdown after successful addition
        setSearchResults([])
        setSearchQuery('')
        setIsOpen(false)
        // Call the callback after the track is successfully added
        onTrackAdded?.()
      })
      .catch((error) => {
        console.error('Failed to add track:', error)
        // Keep search results visible if there was an error
      })
  }

  return (
    <div className='relative flex w-full flex-wrap gap-4 rounded-lg sm:w-10/12 md:w-8/12 md:flex-nowrap lg:w-9/12'>
      <div className='relative flex-1'>
        <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3'>
          <FontAwesomeIcon icon={faSearch} className='text-gray-400' />
        </div>
        <input
          type='text'
          value={searchQuery}
          onChange={(e) => handleChange(e.target.value)}
          placeholder='What do you want to listen to?'
          className='bg-white block w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 leading-5 placeholder-gray-500 focus:border-blue-500 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm'
          aria-label='Search for songs, albums, or artists'
        />
        {isOpen && searchResults.length > 0 && (
          <div
            className='bg-white absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 shadow-lg'
            style={{ isolation: 'isolate' }}
          >
            <div className='bg-white rounded-md'>
              <ul className='overflow-auto py-1 text-base focus:outline-none sm:text-sm'>
                {searchResults.map((track) => (
                  <li
                    key={track.id}
                    onClick={() => handleAddTrack(track)}
                    className='relative cursor-pointer select-none bg-gray-100 py-2 pl-3 pr-9 hover:bg-gray-200'
                  >
                    <div className='flex items-center'>
                      <Image
                        src={track.album.images[2].url}
                        alt={track.name}
                        width={32}
                        height={32}
                        className='h-8 w-8 flex-shrink-0 rounded-full'
                      />
                      <div className='ml-3'>
                        <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {track.name}
                        </p>
                        <p className='text-xs text-gray-500 dark:text-gray-400'>
                          {track.artists.map((artist, index) => (
                            <span key={index}>
                              {artist.name}
                              {index < track.artists.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
export default SearchInput
