import { getBaseUrl } from '@/shared/utils/domain'

export interface PublicTokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

export interface ErrorResponse {
  error: string
  code: string
  status: number
}

export class PublicTokenError extends Error {
  public response: ErrorResponse
  constructor(response: ErrorResponse) {
    super(response.error)
    this.name = 'PublicTokenError'
    this.response = response
  }
}

export async function fetchPublicToken(
  username: string
): Promise<PublicTokenResponse> {
  const response = await fetch(
    `${getBaseUrl()}/api/token/${encodeURIComponent(username)}`,
    {
      cache: 'no-store'
    }
  )

  if (!response.ok) {
    const errorData: ErrorResponse = await response.json()
    throw new PublicTokenError(errorData)
  }

  return response.json()
}
