import { NextResponse } from 'next/server'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

// Configure the route to be dynamic
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TokenInfo {
  lastRefresh: number
  expiresIn: number
  scope: string
  type: string
}

export async function GET(): Promise<NextResponse<TokenInfo>> {
  try {
    const response = await fetch('/api/token', {
      method: 'GET',
      cache: 'no-store'
    })

    if (!response.ok) {
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED)
    }

    const data = await response.json()

    return NextResponse.json({
      lastRefresh: Date.now(),
      expiresIn: data.expires_in * 1000, // Convert to milliseconds
      scope: data.scope,
      type: data.token_type
    })
  } catch (error) {
    console.error('[TokenInfo] Failed to get token info:', error)
    return NextResponse.json(
      {
        lastRefresh: 0,
        expiresIn: 0,
        scope: '',
        type: ''
      },
      { status: 500 }
    )
  }
} 