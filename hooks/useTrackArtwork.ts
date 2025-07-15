import { useState, useEffect } from 'react'

interface TrackArtwork {
  url: string | null
  isLoading: boolean
  error: string | null
}

interface ArtworkResponse {
  artworkUrl: string | null
}

const CACHE_PREFIX = 'track_artwork_'
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours in milliseconds

interface CachedArtwork {
  url: string | null
  timestamp: number
}

function getCachedArtwork(trackId: string): string | null {
  try {
    const cached = localStorage.getItem(`${CACHE_PREFIX}${trackId}`)
    if (!cached) return null

    const data: CachedArtwork = JSON.parse(cached)
    const now = Date.now()

    // Check if cache is still valid
    if (now - data.timestamp < CACHE_DURATION) {
      return data.url
    }

    // Remove expired cache
    localStorage.removeItem(`${CACHE_PREFIX}${trackId}`)
    return null
  } catch {
    return null
  }
}

function setCachedArtwork(trackId: string, url: string | null): void {
  try {
    const data: CachedArtwork = {
      url,
      timestamp: Date.now()
    }
    localStorage.setItem(`${CACHE_PREFIX}${trackId}`, JSON.stringify(data))
  } catch {
    // Ignore localStorage errors
  }
}

export function useTrackArtwork(spotifyTrackId: string | null): TrackArtwork {
  const [artwork, setArtwork] = useState<TrackArtwork>({
    url: null,
    isLoading: false,
    error: null
  })

  useEffect(() => {
    if (!spotifyTrackId) {
      setArtwork({ url: null, isLoading: false, error: null })
      return
    }

    const fetchArtwork = async (): Promise<void> => {
      // Check cache first
      const cachedUrl = getCachedArtwork(spotifyTrackId)
      if (cachedUrl !== null) {
        setArtwork({ url: cachedUrl, isLoading: false, error: null })
        return
      }

      setArtwork((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        console.log(`Fetching artwork for track: ${spotifyTrackId}`)
        const response = await fetch(`/api/track-artwork/${spotifyTrackId}`)

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`Artwork API error for track ${spotifyTrackId}:`, {
            status: response.status,
            statusText: response.statusText,
            errorText
          })
          throw new Error(
            `Failed to fetch artwork: ${response.status} ${response.statusText}`
          )
        }

        const data = (await response.json()) as ArtworkResponse

        console.log(`Artwork response for track ${spotifyTrackId}:`, data)

        // Cache the result
        setCachedArtwork(spotifyTrackId, data.artworkUrl)

        setArtwork({ url: data.artworkUrl, isLoading: false, error: null })
      } catch (error) {
        console.error(
          `Failed to fetch track artwork for ${spotifyTrackId}:`,
          error
        )
        setArtwork({
          url: null,
          isLoading: false,
          error:
            error instanceof Error ? error.message : 'Failed to load artwork'
        })
      }
    }

    void fetchArtwork()
  }, [spotifyTrackId])

  return artwork
}
