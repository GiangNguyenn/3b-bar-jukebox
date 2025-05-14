import { SpotifyPlaybackState } from '@/shared/types'
import { ValidationResult } from '@/shared/types/recovery'

export function validateSpotifyUri(uri: string): boolean {
  if (!uri) return false
  const spotifyUriPattern = /^spotify:(track|playlist|album|artist):[a-zA-Z0-9]+$/
  return spotifyUriPattern.test(uri)
}

export function validatePlaylistId(playlistId: string | null): boolean {
  if (!playlistId) return false
  const playlistIdPattern = /^[a-zA-Z0-9]{22}$/
  return playlistIdPattern.test(playlistId)
}

export function validatePlaybackState(state: SpotifyPlaybackState | null): ValidationResult {
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
  } else if (state.item?.duration_ms && state.progress_ms > state.item.duration_ms) {
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

export function validateDeviceState(deviceId: string | null, state: SpotifyPlaybackState | null): ValidationResult {
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