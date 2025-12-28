'use client'

import { useState, useEffect, Fragment } from 'react'
import { Combobox, Transition } from '@headlessui/react'
import {
  CheckIcon,
  ChevronUpDownIcon,
  XMarkIcon
} from '@heroicons/react/20/solid'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('GenresSelector')

interface GenresSelectorProps {
  selectedGenres: string[]
  onGenresChange: (genres: string[]) => void
}

export function GenresSelector({
  selectedGenres,
  onGenresChange
}: GenresSelectorProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [allGenres, setAllGenres] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Fetch genres from API on mount
  useEffect(() => {
    const fetchGenres = async (): Promise<void> => {
      try {
        const response = await fetch('/api/genres')
        if (response.ok) {
          const data = (await response.json()) as {
            success: boolean
            genres: string[]
          }
          if (data.success && Array.isArray(data.genres)) {
            setAllGenres(data.genres)
          }
        }
      } catch (error) {
        logger(
          'ERROR',
          'Failed to fetch genres from API',
          undefined,
          error instanceof Error ? error : undefined
        )
      } finally {
        setIsLoading(false)
      }
    }
    void fetchGenres()
  }, [])

  const filteredGenres =
    query.length === 0
      ? allGenres
      : allGenres
          .filter((genre) => {
            return genre.toLowerCase().includes(query.toLowerCase())
          })
          .sort((a, b) => {
            const queryLower = query.toLowerCase()
            const aLower = a.toLowerCase()
            const bLower = b.toLowerCase()

            const aExact = aLower === queryLower
            const bExact = bLower === queryLower
            if (aExact && !bExact) return -1
            if (!aExact && bExact) return 1

            const aStartsWith = aLower.startsWith(queryLower)
            const bStartsWith = bLower.startsWith(queryLower)
            if (aStartsWith && !bStartsWith) return -1
            if (!aStartsWith && bStartsWith) return 1

            return aLower.localeCompare(bLower)
          })

  const removeGenre = (genreToRemove: string): void => {
    onGenresChange(selectedGenres.filter((genre) => genre !== genreToRemove))
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-lg'>Genres</CardTitle>
          {selectedGenres.length > 0 && (
            <button
              onClick={() => onGenresChange([])}
              className='text-sm text-muted-foreground hover:text-foreground'
            >
              Clear all
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='space-y-2'>
          {selectedGenres.length > 0 && (
            <div className='flex flex-wrap gap-2'>
              {selectedGenres.map((genre) => (
                <span
                  key={genre}
                  className='inline-flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-sm text-accent-foreground'
                >
                  {genre}
                  <button
                    onClick={() => removeGenre(genre)}
                    className='ml-1 rounded-full p-0.5 hover:bg-accent-foreground/20'
                  >
                    <XMarkIcon className='h-3 w-3' />
                  </button>
                </span>
              ))}
            </div>
          )}

          <Combobox value={selectedGenres} onChange={onGenresChange} multiple>
            <div className='relative'>
              <div className='relative w-full cursor-default overflow-hidden rounded-lg border border-input bg-background text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:text-sm'>
                <Combobox.Input
                  className='w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-foreground focus:ring-0'
                  onChange={(event) => setQuery(event.target.value)}
                  displayValue={(): string => ''}
                  placeholder={
                    isLoading
                      ? 'Loading genres...'
                      : 'Search genres in database...'
                  }
                />
                <Combobox.Button className='absolute inset-y-0 right-0 flex items-center pr-2'>
                  <ChevronUpDownIcon
                    className='h-5 w-5 text-muted-foreground'
                    aria-hidden='true'
                  />
                </Combobox.Button>
              </div>
              <Transition
                as={Fragment}
                leave='transition ease-in duration-100'
                leaveFrom='opacity-100'
                leaveTo='opacity-0'
                afterLeave={(): void => setQuery('')}
              >
                <Combobox.Options className='absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-[#080a0f] py-1 text-base shadow-md ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm'>
                  {isLoading ? (
                    <div className='relative cursor-default select-none px-4 py-2 text-muted-foreground'>
                      Loading...
                    </div>
                  ) : filteredGenres.length === 0 ? (
                    <div className='relative cursor-default select-none px-4 py-2 text-muted-foreground'>
                      Nothing found in database.
                    </div>
                  ) : (
                    filteredGenres.map((genre) => (
                      <Combobox.Option
                        key={genre}
                        value={genre}
                        className={({ active }): string =>
                          `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                            active
                              ? 'bg-accent/50 text-accent-foreground'
                              : 'text-foreground hover:bg-accent/20'
                          }`
                        }
                      >
                        {({ selected, active }): JSX.Element => (
                          <>
                            <span
                              className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}
                            >
                              {genre}
                            </span>
                            {selected ? (
                              <span
                                className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                                  active
                                    ? 'text-accent-foreground'
                                    : 'text-foreground'
                                }`}
                              >
                                <CheckIcon
                                  className='h-5 w-5'
                                  aria-hidden='true'
                                />
                              </span>
                            ) : null}
                          </>
                        )}
                      </Combobox.Option>
                    ))
                  )}
                </Combobox.Options>
              </Transition>
            </div>
          </Combobox>
        </div>
      </CardContent>
    </Card>
  )
}
