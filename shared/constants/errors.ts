export const ERROR_MESSAGES = {
  TRACK_EXISTS: 'Track already exists in playlist',
  NO_PLAYLIST: 'No playlist available',
  FAILED_TO_ADD: 'Failed to add track to playlist',
  FAILED_TO_LOAD: 'Failed to load playlist',
  NO_SUGGESTIONS: 'No suitable track suggestions found',
  MAX_RETRIES: 'Failed to add track after maximum retries',
  FAILED_TO_CREATE: 'Failed to create playlist',
  FAILED_TO_REMOVE: 'Failed to remove track from playlist',
  INVALID_PLAYLIST_DATA: 'Invalid playlist data. Please try again.',
  UNAUTHORIZED: 'Please log in again to create playlists.',
  MALFORMED_RESPONSE: 'Received malformed response from server',
  GENERIC_ERROR: 'An error occurred'
} as const

export type ErrorMessage = (typeof ERROR_MESSAGES)[keyof typeof ERROR_MESSAGES]
