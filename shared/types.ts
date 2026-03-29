// Only non-Spotify types should remain in this file.

export interface TokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
  creation_time: number
}

// Add any other non-Spotify types here
