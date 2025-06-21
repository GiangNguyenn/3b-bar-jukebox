import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { ValidationResult } from '@/shared/types/recovery'
import { sendApiRequest } from '@/shared/api'

export function validateSpotifyUri(uri: string): boolean {
  if (!uri) return false
  const spotifyUriPattern =
    /^spotify:(track|playlist|album|artist):[a-zA-Z0-9]+$/
  return spotifyUriPattern.test(uri)
}

export function validatePlaylistId(playlistId: string | null): boolean {
  if (!playlistId) return false
  const playlistIdPattern = /^[a-zA-Z0-9]{22}$/
  return playlistIdPattern.test(playlistId)
}

export function validatePlaybackState(
  state: SpotifyPlaybackState | null
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  }

  if (!state) {
    result.isValid = false
    result.errors.push('No playback state available')
    return result
  }

  // Validate device
  if (!state.device?.id) {
    result.isValid = false
    result.errors.push('No device ID in playback state')
  }

  // Validate track
  if (!state.item?.uri) {
    result.isValid = false
    result.errors.push('No track URI in playback state')
  } else if (!validateSpotifyUri(state.item.uri)) {
    result.isValid = false
    result.errors.push('Invalid track URI format')
  }

  // Validate progress
  if (typeof state.progress_ms !== 'number') {
    result.isValid = false
    result.errors.push('Invalid progress value')
  } else if (state.progress_ms < 0) {
    result.isValid = false
    result.errors.push('Negative progress value')
  } else if (
    state.item?.duration_ms &&
    state.progress_ms > state.item.duration_ms
  ) {
    result.isValid = false
    result.errors.push('Progress exceeds track duration')
  }

  // Validate context
  if (!state.context?.uri) {
    result.warnings.push('No context URI in playback state')
  } else if (!validateSpotifyUri(state.context.uri)) {
    result.warnings.push('Invalid context URI format')
  }

  // Validate timestamps
  if (state.timestamp && state.timestamp > Date.now()) {
    result.warnings.push('Future timestamp detected')
  }

  return result
}

export function validateDeviceState(
  deviceId: string | null,
  state: SpotifyPlaybackState | null
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  }

  if (!deviceId) {
    result.isValid = false
    result.errors.push('No device ID provided')
    return result
  }

  if (!state?.device?.id) {
    result.isValid = false
    result.errors.push('No device in playback state')
    return result
  }

  if (state.device.id !== deviceId) {
    result.isValid = false
    result.errors.push('Device ID mismatch')
  }

  if (!state.device.is_active) {
    result.warnings.push('Device is not active')
  }

  if (state.device.volume_percent === undefined) {
    result.warnings.push('Device volume not set')
  }

  return result
}

export function validatePlaybackRequest(
  contextUri: string,
  positionMs: number,
  offsetUri?: string
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  }

  if (!validateSpotifyUri(contextUri)) {
    result.isValid = false
    result.errors.push('Invalid context URI')
  }

  if (typeof positionMs !== 'number' || positionMs < 0) {
    result.isValid = false
    result.errors.push('Invalid position value')
  }

  if (offsetUri && !validateSpotifyUri(offsetUri)) {
    result.isValid = false
    result.errors.push('Invalid offset URI')
  }

  return result
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

interface TrackResponse {
  name: string
}

export async function validatePlaybackStateWithDetails(
  playlistId: string,
  trackUri: string | null,
  position: number
): Promise<{
  isValid: boolean
  error?: string
  details?: {
    playlistValid: boolean
    trackValid: boolean
    positionValid: boolean
    playlistName?: string
    trackName?: string
  }
}> {
  console.log('[Playback Validation] Starting validation:', {
    playlistId,
    trackUri,
    position,
    timestamp: new Date().toISOString()
  })

  try {
    // Validate playlist exists and is accessible
    const playlistResponse = await sendApiRequest<PlaylistResponse>({
      path: `playlists/${playlistId}`,
      method: 'GET'
    })

    if (!playlistResponse) {
      console.error('[Playback Validation] Playlist not found:', {
        playlistId,
        timestamp: new Date().toISOString()
      })
      return {
        isValid: false,
        error: 'Playlist not found',
        details: {
          playlistValid: false,
          trackValid: false,
          positionValid: false
        }
      }
    }

    // If we have a track URI, validate the track
    let trackValid = true
    let trackName: string | undefined
    if (trackUri) {
      try {
        const trackId = trackUri.split(':').pop()
        const trackResponse = await sendApiRequest<TrackResponse>({
          path: `tracks/${trackId}`,
          method: 'GET'
        })

        if (!trackResponse) {
          console.error('[Playback Validation] Track not found:', {
            trackUri,
            timestamp: new Date().toISOString()
          })
          trackValid = false
        } else {
          trackName = trackResponse.name
        }
      } catch (error) {
        console.error('[Playback Validation] Track validation failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          trackUri,
          timestamp: new Date().toISOString()
        })
        trackValid = false
      }
    }

    // Validate position is reasonable
    const positionValid = position >= 0 && position < 3600000 // Max 1 hour

    const isValid = trackValid && positionValid

    console.log('[Playback Validation] Validation complete:', {
      isValid,
      playlistValid: true,
      trackValid,
      positionValid,
      playlistName: playlistResponse.name,
      trackName,
      timestamp: new Date().toISOString()
    })

    return {
      isValid,
      error: !isValid ? 'Invalid playback state' : undefined,
      details: {
        playlistValid: true,
        trackValid,
        positionValid,
        playlistName: playlistResponse.name,
        trackName
      }
    }
  } catch (error) {
    console.error('[Playback Validation] Validation failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      playlistId,
      trackUri,
      timestamp: new Date().toISOString()
    })
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: {
        playlistValid: false,
        trackValid: false,
        positionValid: false
      }
    }
  }
}
