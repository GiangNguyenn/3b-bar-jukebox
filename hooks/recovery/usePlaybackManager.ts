import { useState, useCallback } from 'react'
import { sendApiRequest } from '@/shared/api'
import { SpotifyApiService } from '@/services/spotifyApi'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { verifyPlaybackResume } from '@/shared/utils/recovery/playback-verification'
import { validatePlaybackStateWithDetails } from '@/shared/utils/recovery/validation'

interface PlaybackState {
  isPlaying: boolean
  currentTrack: string | null
  position: number
  error: string | null
  isVerifying: boolean
}

interface PlaylistResponse {
  name: string
  tracks: {
    items: Array<{
      track: {
        uri: string
        name: string
      }
    }>
  }
}

export function usePlaybackManager(playlistId: string | null) {
  const [state, setState] = useState<PlaybackState>({
    isPlaying: false,
    currentTrack: null,
    position: 0,
    error: null,
    isVerifying: false
  })

  const validatePlaylist = useCallback(async (): Promise<boolean> => {
    if (!playlistId) return false

    try {
      const response = await sendApiRequest<PlaylistResponse>({
        path: `playlists/${playlistId}`,
        method: 'GET'
      })
      return !!response
    } catch {
      return false
    }
  }, [playlistId])

  const validateTrack = useCallback(
    async (trackUri: string): Promise<boolean> => {
      try {
        const response = await sendApiRequest({
          path: `tracks/${trackUri.split(':').pop()}`,
          method: 'GET'
        })
        return !!response
      } catch {
        return false
      }
    },
    []
  )

  const resumePlayback = useCallback(
    async (
      deviceId: string,
      contextUri: string,
      position: number = 0
    ): Promise<boolean> => {
      if (!deviceId || !playlistId) {
        setState((prev) => ({
          ...prev,
          error: 'Missing device ID or playlist ID'
        }))
        return false
      }

      try {
        setState((prev) => ({ ...prev, isVerifying: true, error: null }))

        // Validate playlist
        const isPlaylistValid = await validatePlaylist()
        if (!isPlaylistValid) {
          throw new Error('Playlist not found')
        }

        // Get current playback state
        const currentState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        // Use the current position from the state, fallback to passed position
        const currentPosition = currentState?.progress_ms ?? position

        // Validate playback state
        const validationResult = await validatePlaybackStateWithDetails(
          playlistId,
          currentState?.item?.uri ?? contextUri,
          currentPosition
        )

        if (!validationResult.isValid) {
          if (!validationResult.details?.trackValid) {
            // Try to get first track from playlist
            const playlist = await sendApiRequest<PlaylistResponse>({
              path: `playlists/${playlistId}`,
              method: 'GET'
            })

            if (!playlist?.tracks?.items?.[0]?.track?.uri) {
              throw new Error('No tracks found in playlist')
            }

            const spotifyApi = SpotifyApiService.getInstance()
            await spotifyApi.resumePlayback()
          } else {
            throw new Error(validationResult.error || 'Invalid playback state')
          }
        } else {
          const spotifyApi = SpotifyApiService.getInstance()
          await spotifyApi.resumePlayback()
        }

        // Add a small delay to allow playback state to settle
        await new Promise((resolve) => setTimeout(resolve, 2000))

        // Verify playback resumed correctly
        const verificationResult = await verifyPlaybackResume(
          `spotify:playlist:${playlistId}`,
          deviceId
        )

        console.log(
          '[PlaybackManager] Verification result:',
          verificationResult
        )

        if (!verificationResult.isSuccessful) {
          console.error('[PlaybackManager] Verification failed:', {
            reason: verificationResult.reason,
            details: verificationResult.details,
            deviceId,
            playlistId
          })
          throw new Error(verificationResult.reason)
        }

        setState({
          isPlaying: true,
          currentTrack: currentState?.item?.uri ?? null,
          position: currentState?.progress_ms ?? 0,
          error: null,
          isVerifying: false
        })

        return true
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        setState((prev) => ({
          ...prev,
          isPlaying: false,
          error: errorMessage,
          isVerifying: false
        }))
        return false
      }
    },
    [playlistId, validatePlaylist]
  )

  const reset = useCallback(() => {
    setState({
      isPlaying: false,
      currentTrack: null,
      position: 0,
      error: null,
      isVerifying: false
    })
  }, [])

  return {
    state,
    resumePlayback,
    validateTrack,
    reset
  }
}
