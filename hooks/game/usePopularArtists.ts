import { useState, useEffect } from 'react'
import type { TargetArtist } from '@/services/gameService'

interface UsePopularArtistsResult {
  artists: TargetArtist[]
  isLoading: boolean
  error: string | null
}

export function usePopularArtists(): UsePopularArtistsResult {
  const [artists, setArtists] = useState<TargetArtist[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchArtists(): Promise<void> {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch('/api/game/artists')

        if (!response.ok) {
          throw new Error(`Failed to fetch artists: ${response.statusText}`)
        }

        const data = (await response.json()) as {
          artists?: Array<{
            id?: string
            name: string
            spotify_artist_id: string
            genre?: string
          }>
          error?: string
        }

        if (data.error) {
          throw new Error(data.error)
        }

        if (!data.artists) {
          throw new Error('No artists data in response')
        }

        // Map to TargetArtist format
        // Use spotify_artist_id as the id field since that's what Spotify API expects
        const mappedArtists: TargetArtist[] = data.artists.map((artist) => ({
          id: artist.spotify_artist_id,
          name: artist.name,
          genre: artist.genre
        }))

        setArtists(mappedArtists)
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to load artists'
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    void fetchArtists()
  }, [])

  return { artists, isLoading, error }
}
