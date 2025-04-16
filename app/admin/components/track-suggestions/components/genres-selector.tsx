'use client'

import { FALLBACK_GENRES } from '@/shared/constants/trackSuggestion'

interface GenresSelectorProps {
  selectedGenres: string[]
  onGenresChange: (genres: string[]) => void
}

export function GenresSelector({
  selectedGenres,
  onGenresChange
}: GenresSelectorProps): JSX.Element {
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

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-medium'>Genres</h3>
      <div className='relative'>
        <select
          multiple
          onChange={handleGenreChange}
          value={selectedGenres}
          className='min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        >
          {FALLBACK_GENRES.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>
      </div>
      {selectedGenres.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {selectedGenres.map((genre) => (
            <span
              key={genre}
              className='rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800'
            >
              {genre}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
