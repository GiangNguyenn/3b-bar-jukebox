'use client'

import { ALL_SPOTIFY_GENRES } from '@/shared/constants/trackSuggestion'
import { useState, useMemo, useCallback } from 'react'
import { Combobox } from '@headlessui/react'
import { ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { useDebounce } from 'use-debounce'
import { FixedSizeList as List } from 'react-window'
import { Check } from 'lucide-react'
import { type Genre } from '@/shared/constants/trackSuggestion'

interface GenresSelectorProps {
  selectedGenres: Genre[]
  onGenresChange: (genres: Genre[]) => void
}

// Convert readonly tuple to mutable array
const SPOTIFY_GENRES: string[] = [...ALL_SPOTIFY_GENRES]

// Pre-compute lowercase versions of all genres
const LOWER_CASE_GENRES: string[] = SPOTIFY_GENRES.map((genre) =>
  genre.toLowerCase()
)

export function GenresSelector({
  selectedGenres,
  onGenresChange
}: GenresSelectorProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [debouncedQuery] = useDebounce(query, 300)

  const filteredGenres = useMemo(() => {
    if (!Array.isArray(SPOTIFY_GENRES)) return []
    if (debouncedQuery === '') return SPOTIFY_GENRES.slice(0, 5)

    const lowerQuery = debouncedQuery.toLowerCase()

    // Score each genre based on match quality
    const scoredGenres = SPOTIFY_GENRES.map((genre, index) => {
      const lowerGenre = LOWER_CASE_GENRES[index]
      let score = 0

      // Exact match gets highest score
      if (lowerGenre === lowerQuery) score += 100

      // Starts with query gets high score
      if (lowerGenre.startsWith(lowerQuery)) score += 50

      // Contains query gets medium score
      if (lowerGenre.includes(lowerQuery)) score += 30

      // Contains words from query gets lower score
      const queryWords = lowerQuery.split(' ')
      const genreWords = lowerGenre.split(' ')
      const matchingWords = queryWords.filter((word) =>
        genreWords.some((genreWord) => genreWord.includes(word))
      )
      score += matchingWords.length * 10

      return { genre, score }
    })

    // Sort by score and take top 5
    return scoredGenres
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.genre)
  }, [debouncedQuery])

  const handleGenreToggle = useCallback(
    (genres: Genre[]): void => {
      if (genres.length === 0) {
        onGenresChange([])
        return
      }

      const lastGenre = genres[genres.length - 1]
      const isSelected = selectedGenres.includes(lastGenre)

      const newGenres = isSelected
        ? selectedGenres.filter((g) => g !== lastGenre)
        : [...selectedGenres, lastGenre]

      onGenresChange(newGenres)
    },
    [selectedGenres, onGenresChange]
  )

  if (!Array.isArray(SPOTIFY_GENRES)) {
    console.error(
      '[GenresSelector] SPOTIFY_GENRES is not defined or not an array'
    )
    return (
      <div className='space-y-4'>
        <h3 className='text-lg font-medium'>Genres</h3>
        <div className='text-sm text-destructive'>
          Error: Unable to load genres. Please try refreshing the page.
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-medium'>Genres</h3>
      <Combobox value={selectedGenres} onChange={handleGenreToggle} multiple>
        <div className='relative'>
          <Combobox.Input
            className='w-full rounded-lg border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
            placeholder='Search genres...'
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            value={query}
            displayValue={(genres: Genre[]) => genres.join(', ')}
          />
          <Combobox.Button className='absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 focus:outline-none'>
            <ChevronUpDownIcon
              className='h-5 w-5 text-muted-foreground'
              aria-hidden='true'
            />
          </Combobox.Button>
        </div>

        <div className='relative'>
          <Combobox.Options className='absolute z-50 mt-1 max-h-60 w-full overflow-hidden rounded-lg bg-gray-100 shadow-lg ring-1 ring-black ring-opacity-5'>
            {filteredGenres.length === 0 && query !== '' ? (
              <div className='relative cursor-default select-none px-4 py-2 text-gray-500'>
                No genres found.
              </div>
            ) : (
              <List
                height={Math.min(filteredGenres.length * 36, 240)}
                itemCount={filteredGenres.length}
                itemSize={36}
                width='100%'
              >
                {({ index, style }) => {
                  const genre = filteredGenres[index] as Genre
                  return (
                    <Combobox.Option
                      key={genre}
                      value={genre}
                      className={() =>
                        `relative cursor-default select-none bg-gray-100 py-2 pl-10 pr-4 text-gray-900 hover:bg-gray-200 hover:font-medium`
                      }
                      style={style}
                    >
                      {({ selected }) => (
                        <>
                          <span
                            className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}
                          >
                            {genre}
                          </span>
                          {selected && (
                            <span className='absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600'>
                              <Check className='h-5 w-5' aria-hidden='true' />
                            </span>
                          )}
                        </>
                      )}
                    </Combobox.Option>
                  )
                }}
              </List>
            )}
          </Combobox.Options>
        </div>
      </Combobox>

      {selectedGenres.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {selectedGenres.map((genre) => (
            <span
              key={genre}
              className='bg-primary/10 text-primary inline-flex items-center rounded-full px-3 py-1 text-sm font-medium'
            >
              {genre}
              <button
                type='button'
                onClick={() => handleGenreToggle([genre])}
                className='hover:bg-primary/20 focus:ring-primary ml-2 rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-offset-2'
                aria-label={`Remove ${genre}`}
              >
                <svg
                  className='h-3 w-3'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M6 18L18 6M6 6l12 12'
                  />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
