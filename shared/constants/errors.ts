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
  UNAUTHORIZED:
    'Spotify Premium account required. Please upgrade your account and sign in again.',
  MALFORMED_RESPONSE: 'Received malformed response from server',
  GENERIC_ERROR:
    'An error occurred. This jukebox requires a Spotify Premium account to function properly.',
  PROFILE_NOT_FOUND: 'User profile not found',
  FAILED_TO_FETCH_PROFILE: 'Failed to fetch user profile',
  JUKEBOX_OFFLINE: 'Jukebox is currently offline',
  RECONNECTING: 'Reconnecting to jukebox...',
  TOKEN_RECOVERY_FAILED: 'Unable to connect to jukebox',
  PREMIUM_REQUIRED:
    'This feature requires a Spotify Premium account. Please upgrade your Spotify account to premium to use this jukebox.',
  PREMIUM_ACCOUNT_ERROR:
    'Spotify Premium is required for playback control. Please upgrade your account or verify your premium status.'
} as const

export type ErrorMessage = (typeof ERROR_MESSAGES)[keyof typeof ERROR_MESSAGES]
