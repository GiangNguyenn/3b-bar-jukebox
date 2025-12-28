'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { SparklesIcon, MusicalNoteIcon } from '@heroicons/react/24/outline'
import { useTrackSuggestions } from './hooks/useTrackSuggestions'
import { GenresSelector } from './components/genres-selector'
import { YearRangeSelector } from './components/year-range-selector'
import { PopularitySelector } from './components/popularity-selector'
import { MaxSongLengthSelector } from './components/max-song-length-selector'
import { AutoFillTargetSelector } from './components/auto-fill-target-selector'
import { LastSuggestedTrack } from './components/last-suggested-track'
import {
  type LastSuggestedTrackInfo,
  type TrackSuggestionsState
} from '@/shared/types/trackSuggestions'

import { Toast } from '@/components/ui'

interface TrackSuggestionsTabProps {
  onStateChange?: (state: TrackSuggestionsState) => void
  initialState?: Partial<TrackSuggestionsState>
}

export function TrackSuggestionsTab({
  onStateChange,
  initialState
}: TrackSuggestionsTabProps): JSX.Element {
  const {
    state,
    setGenres,
    setYearRange,
    setPopularity,
    setMaxSongLength,
    setAutoFillTargetSize
  } = useTrackSuggestions(initialState)

  // Notify parent of state changes if needed
  useEffect(() => {
    if (onStateChange) {
      onStateChange(state)
    }
  }, [state, onStateChange])

  const [isLoading, setIsLoading] = useState(false)
  const [lastSuggested, setLastSuggested] =
    useState<LastSuggestedTrackInfo | null>(null)
  const [toast, setToast] = useState<{
    message: string
    variant: 'success' | 'warning' | 'info'
  } | null>(null)

  const showToast = (
    message: string,
    variant: 'success' | 'warning' | 'info' = 'success'
  ): void => {
    setToast({ message, variant })
  }

  // Load last suggested track on mount
  useEffect(() => {
    const fetchLastSuggested = async (): Promise<void> => {
      try {
        const response = await fetch('/api/track-suggestions?type=latest')
        if (response.ok) {
          const data = (await response.json()) as {
            success: boolean
            track: LastSuggestedTrackInfo
          }
          if (data.success && data.track) {
            setLastSuggested(data.track)
          }
        }
      } catch (error) {
        console.error('Failed to fetch last suggested track:', error)
      }
    }

    void fetchLastSuggested()
  }, [])

  const handleManualTrigger = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/track-suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          genres: state.genres,
          yearRange: state.yearRange,
          popularity: state.popularity,
          maxSongLength: state.maxSongLength,
          autoFillTargetSize: state.autoFillTargetSize,
          excludedTrackIds: [] // We don't track excluded IDs in client state for manual trigger
        })
      })

      const data = (await response.json()) as {
        success: boolean
        track?: {
          name: string
          artists: Array<{ name: string }>
          album: { name: string }
          uri: string
          popularity: number
          duration_ms: number
          preview_url: string | null
        }
        message?: string
        searchDetails?: { genresTried: string[] }
      }

      if (data.success) {
        if (data.track) {
          setLastSuggested({
            name: data.track.name,
            artist: data.track.artists[0]?.name ?? 'Unknown Artist',
            album: data.track.album.name,
            uri: data.track.uri,
            popularity: data.track.popularity,
            duration_ms: data.track.duration_ms,
            preview_url: data.track.preview_url,
            genres: data.searchDetails?.genresTried ?? []
          })
          showToast(
            `Found: ${data.track.name} by ${data.track.artists[0]?.name}`
          )
        } else {
          showToast(
            'Could not find a track matching your criteria in the database.',
            'warning'
          )
        }
      } else {
        showToast(data.message ?? 'Failed to generate suggestion', 'warning')
      }
    } catch (error) {
      console.error('Error triggering suggestion:', error)
      showToast('An unexpected error occurred', 'warning')
    } finally {
      setIsLoading(false)
    }
  }

  const applyPreset = (
    name: string,
    preset: {
      genres: string[]
      yearRange: [number, number]
      popularity: number
    }
  ): void => {
    setGenres(preset.genres)
    setYearRange(preset.yearRange)
    setPopularity(preset.popularity)

    showToast(`Applied ${name} settings`)
  }

  const buttonBaseClass =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'
  const outlineButtonClass = `${buttonBaseClass} border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground px-4 py-2`
  const primaryButtonClass = `${buttonBaseClass} bg-primary text-primary-foreground shadow hover:bg-primary/90 px-8 py-2 text-lg`

  return (
    <div className='relative mx-auto max-w-2xl space-y-6'>
      {/* Toast Notification Overlay */}
      {toast && (
        <div className='fixed bottom-4 right-4 z-[100] animate-in fade-in slide-in-from-bottom-5'>
          <Toast
            message={toast.message}
            variant={toast.variant}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      <div className='flex flex-col gap-6'>
        <Card>
          <CardHeader>
            <CardTitle>Presets</CardTitle>
            <CardDescription>
              Quick configurations for different vibes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-2 gap-4'>
              <button
                onClick={() =>
                  applyPreset('Party', {
                    genres: ['Pop', 'Dance', 'Hip Hop', 'Electro'],
                    yearRange: [2010, new Date().getFullYear()],
                    popularity: 70
                  })
                }
                className={`${outlineButtonClass} h-auto flex-col py-4`}
              >
                <span className='mb-1 text-lg'>🎉</span>
                <span className='font-semibold'>Party</span>
              </button>
              <button
                onClick={() =>
                  applyPreset('Chill', {
                    genres: ['Lo-fi', 'Jazz', 'Acoustic', 'Ambient'],
                    yearRange: [1990, new Date().getFullYear()],
                    popularity: 40
                  })
                }
                className={`${outlineButtonClass} h-auto flex-col py-4`}
              >
                <span className='mb-1 text-lg'>☕</span>
                <span className='font-semibold'>Chill</span>
              </button>
              <button
                onClick={() =>
                  applyPreset('Rock', {
                    genres: ['Rock', 'Alternative', 'Indie', 'Metal'],
                    yearRange: [1970, 2010],
                    popularity: 60
                  })
                }
                className={`${outlineButtonClass} h-auto flex-col py-4`}
              >
                <span className='mb-1 text-lg'>🎸</span>
                <span className='font-semibold'>Rock</span>
              </button>
              <button
                onClick={() =>
                  applyPreset('Classics', {
                    genres: ['Soul', 'Blues', 'Classic Rock', '80s'],
                    yearRange: [1960, 1990],
                    popularity: 80
                  })
                }
                className={`${outlineButtonClass} h-auto flex-col py-4`}
              >
                <span className='mb-1 text-lg'>📻</span>
                <span className='font-semibold'>Classics</span>
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <SparklesIcon className='h-5 w-5 text-yellow-500' />
              Suggestion Settings
            </CardTitle>
            <CardDescription>
              Configure how the Jukebox finds new songs from your local
              database.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-6'>
            <GenresSelector
              selectedGenres={state.genres}
              onGenresChange={setGenres}
            />

            <YearRangeSelector
              range={state.yearRange}
              onRangeChange={setYearRange}
            />

            <PopularitySelector
              popularity={state.popularity}
              onPopularityChange={setPopularity}
            />

            <MaxSongLengthSelector
              length={state.maxSongLength}
              onLengthChange={setMaxSongLength}
            />

            <AutoFillTargetSelector
              targetSize={state.autoFillTargetSize}
              onTargetSizeChange={setAutoFillTargetSize}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How Suggestions Work</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2 text-sm text-muted-foreground'>
            <p>
              When the queue gets low (below your specified Auto-Fill Target),
              the system searches your <strong>local database</strong> for
              tracks that match your configured criteria (Genres, Year,
              Popularity, etc.).
            </p>
            <p>
              It selects a random track from the matching candidates in your
              database. Suggestions are 100% database-driven and do not use
              external APIs for search.
            </p>
            <div className='mt-4 flex items-center gap-2 rounded-md border bg-muted/50 p-3'>
              <MusicalNoteIcon className='h-5 w-5' />
              <span>
                Try the <strong>Test Suggestion</strong> button below to see
                what valid tracks look like based on current settings.
              </span>
            </div>
          </CardContent>
        </Card>

        <button
          onClick={() => {
            void handleManualTrigger()
          }}
          disabled={isLoading}
          className={`${primaryButtonClass} w-full`}
        >
          {isLoading ? 'Finding Track...' : 'Test Suggestion'}
        </button>

        {lastSuggested && <LastSuggestedTrack trackInfo={lastSuggested} />}
      </div>
    </div>
  )
}
