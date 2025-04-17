'use client'

import { FALLBACK_GENRES } from '@/shared/constants/trackSuggestion'
import { useId } from 'react'

interface GenresSelectorProps {
  selectedGenres: string[]
  onGenresChange: (genres: string[]) => void
}

export function GenresSelector({
  selectedGenres,
  onGenresChange
}: GenresSelectorProps): JSX.Element {
  const id = useId()
  const labelId = `${id}-label`
  const selectId = `${id}-select`

  // Ensure FALLBACK_GENRES is defined and is an array
  if (!Array.isArray(FALLBACK_GENRES)) {
    console.error(
      '[GenresSelector] FALLBACK_GENRES is not defined or not an array'
    )
    return (
      <div className='space-y-4'>
        <h3 id={labelId} className='text-lg font-medium'>
          Genres
        </h3>
        <div className='text-sm text-destructive'>
          Error: Unable to load genres. Please try refreshing the page.
        </div>
      </div>
    )
  }

  const handleGenreChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const options = e.target.options
    const selected = []
    for (let i = 0; i < options.length; i++) {
      if (options[i].selected) {
        selected.push(options[i].value)
      }
    }
    onGenresChange(selected)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const select = e.currentTarget
      const options = select.options
      const selected = []
      for (let i = 0; i < options.length; i++) {
        if (options[i].selected) {
          selected.push(options[i].value)
        }
      }
      onGenresChange(selected)
    }
  }

  return (
    <div className='space-y-4'>
      <h3 id={labelId} className='text-lg font-medium'>
        Genres
      </h3>
      <div className='relative'>
        <select
          id={selectId}
          multiple
          aria-labelledby={labelId}
          aria-multiselectable
          onChange={handleGenreChange}
          onKeyDown={handleKeyDown}
          value={selectedGenres}
          className='min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
        >
          {FALLBACK_GENRES.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>
        <div className='mt-2 text-sm text-muted-foreground'>
          Hold Ctrl/Cmd to select multiple genres
        </div>
      </div>
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
                onClick={() => {
                  onGenresChange(selectedGenres.filter((g) => g !== genre))
                }}
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
