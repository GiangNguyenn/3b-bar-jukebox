import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { SpotifyTokenResponse } from '@/shared/types/spotify'

// Types
interface ErrorResponse {
  error: string
  code: string
  status: number
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface UserProfile {
  id: string
  spotify_access_token: string
  spotify_refresh_token: string
  spotify_token_expires_at: string
}

// Constants
const AUTH = {
  TOKEN_URL: 'https://accounts.spotify.com/api/token',
  GRANT_TYPE: 'refresh_token',
  CONTENT_TYPE: 'application/x-www-form-urlencoded'
} as const

// Environment variables
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  throw new Error(
    'Missing required environment variables: SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET'
  )
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(): Promise<
  NextResponse<TokenResponse | ErrorResponse>
> {
  try {
    const cookieStore = cookies()

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          }
        }
      }
    )

    // Get the current user's session
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      console.error('[Token] Error getting current user:', userError)
      return NextResponse.json(
        {
          error: 'User not authenticated',
          code: 'NOT_AUTHENTICATED',
          status: 401
        },
        { status: 401 }
      )
    }

    // Get the current user's profile from database
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      console.error('[Token] Error fetching user profile:', profileError)
      return NextResponse.json(
        {
          error: 'Failed to get user credentials',
          code: 'USER_PROFILE_ERROR',
          status: 500
        },
        { status: 500 }
      )
    }

    // Type guard to ensure userProfile has required fields
    const typedProfile = userProfile as UserProfile
    if (
      !typedProfile.spotify_access_token ||
      !typedProfile.spotify_refresh_token ||
      !typedProfile.spotify_token_expires_at
    ) {
      return NextResponse.json(
        {
          error: 'Invalid user profile data - missing Spotify credentials',
          code: 'INVALID_PROFILE_DATA',
          status: 500
        },
        { status: 500 }
      )
    }

    // Check if token needs refresh
    const tokenExpiresAt = Number(typedProfile.spotify_token_expires_at)
    const now = Math.floor(Date.now() / 1000)

    if (tokenExpiresAt <= now) {
      // Token is expired, refresh it
      const response = await fetch(AUTH.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': AUTH.CONTENT_TYPE,
          Authorization: `Basic ${Buffer.from(
            `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: AUTH.GRANT_TYPE,
          refresh_token: typedProfile.spotify_refresh_token
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Token] Error refreshing token:', errorText)
        return NextResponse.json(
          {
            error: 'Failed to refresh token',
            code: 'TOKEN_REFRESH_ERROR',
            status: 500
          },
          { status: 500 }
        )
      }

      const tokenData = (await response.json()) as SpotifyTokenResponse

      // Update the token in the database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: tokenData.access_token,
          spotify_token_expires_at:
            Math.floor(Date.now() / 1000) + tokenData.expires_in
        })
        .eq('id', userProfile.id)

      if (updateError) {
        console.error('[Token] Error updating token:', updateError)
      }

      return NextResponse.json({
        access_token: tokenData.access_token,
        refresh_token:
          tokenData.refresh_token ?? typedProfile.spotify_refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + tokenData.expires_in
      })
    }

    // Token is still valid, return it
    return NextResponse.json({
      access_token: typedProfile.spotify_access_token,
      refresh_token: typedProfile.spotify_refresh_token,
      expires_at: tokenExpiresAt
    })
  } catch (error) {
    console.error('[Token] Error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
