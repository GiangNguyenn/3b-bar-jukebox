import { SpotifyPlaylistItem, SpotifyPlaylists } from '@/shared/types'
import { sendApiRequest } from '../shared/api'
import { useMyPlaylists } from './useMyPlaylists'
import { useEffect, useState } from 'react'
import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors'

const FIXED_PLAYLIST_NAME = '3B Saigon'
const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

export const useFixedPlaylist = () => {
  const [fixedPlaylistId, setFixedPlaylistId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<ErrorMessage | null>(null)
  const [isInitialFetchComplete, setIsInitialFetchComplete] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const { data: playlists, isError, refetchPlaylists } = useMyPlaylists()

  // Check for existing playlist whenever playlists data changes
  useEffect(() => {
    if (playlists?.items) {
      const existingPlaylist = playlists.items.find(
        (playlist) => playlist.name === FIXED_PLAYLIST_NAME
      )
      if (existingPlaylist) {
        setFixedPlaylistId(existingPlaylist.id)
      } else {
        setError(ERROR_MESSAGES.FAILED_TO_LOAD)
      }
    }
  }, [playlists])

  // Fetch playlists on mount with retry logic
  useEffect(() => {
    const fetchPlaylists = async () => {
      try {
        // Force a revalidation with fresh data
        await refetchPlaylists(
          async () => {
            const response = await sendApiRequest<SpotifyPlaylists>({
              path: '/me/playlists'
            })
            return response
          },
          {
            revalidate: true,
            populateCache: true,
            rollbackOnError: true
          }
        )
        setIsInitialFetchComplete(true)
      } catch (error) {
        console.error('[Fixed Playlist] Error fetching playlists:', error)

        // Check if it's a rate limit error
        if (error instanceof Error && error.message.includes('429')) {
          if (retryCount < MAX_RETRIES) {
            console.log(
              `[Fixed Playlist] Rate limited, retrying in ${RETRY_DELAY}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`
            )
            setRetryCount((prev) => prev + 1)
            setTimeout(() => {
              void fetchPlaylists()
            }, RETRY_DELAY)
            return
          }
          setError(ERROR_MESSAGES.FAILED_TO_LOAD)
        } else {
          setError(ERROR_MESSAGES.FAILED_TO_LOAD)
        }
        setIsInitialFetchComplete(true)
      }
    }
    void fetchPlaylists()
  }, [refetchPlaylists, retryCount])

  return {
    fixedPlaylistId,
    playlists,
    isLoading,
    error,
    isError,
    isInitialFetchComplete
  }
}
