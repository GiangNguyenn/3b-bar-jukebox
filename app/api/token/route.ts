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
  expires_in: number
}

interface UserProfile {
  id: string
  spotify_access_token: string | null
  spotify_refresh_token: string | null
  spotify_token_expires_at: number | null
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

    if (profileError) {
      // If profile doesn't exist, try to create one
      if (profileError.code === 'PGRST116') {
        // Try to get Spotify tokens from session
        const session = await supabase.auth.getSession()
        const spotifyAccessToken = session.data.session?.provider_token as
          | string
          | undefined
        const spotifyRefreshToken = session.data.session
          ?.provider_refresh_token as string | undefined

        if (spotifyAccessToken && spotifyRefreshToken) {
          const { error: createError } = await supabase
            .from('profiles')
            .insert({
              id: user.id,
              spotify_user_id: user.id,
              display_name:
                (user.user_metadata?.name as string | undefined) ??
                user.email?.split('@')[0] ??
                'user',
              avatar_url:
                (user.user_metadata?.avatar_url as string | undefined) ?? null,
              spotify_access_token: spotifyAccessToken,
              spotify_refresh_token: spotifyRefreshToken,
              spotify_token_expires_at: Math.floor(Date.now() / 1000) + 3600, // Assume 1 hour
              is_premium: false,
              premium_verified_at: null
            })

          if (createError) {
            return NextResponse.json(
              {
                error: 'Failed to create user profile',
                code: 'PROFILE_CREATION_ERROR',
                status: 500
              },
              { status: 500 }
            )
          }

          // Return the tokens from session
          return NextResponse.json({
            access_token: spotifyAccessToken,
            refresh_token: spotifyRefreshToken,
            expires_in: 3600
          })
        } else {
          return NextResponse.json(
            {
              error: 'No Spotify tokens found in session',
              code: 'NO_SPOTIFY_TOKENS',
              status: 500
            },
            { status: 500 }
          )
        }
      }

      return NextResponse.json(
        {
          error: 'Failed to get user credentials',
          code: 'USER_PROFILE_ERROR',
          status: 500
        },
        { status: 500 }
      )
    }

    if (!userProfile) {
      return NextResponse.json(
        {
          error: 'User profile not found',
          code: 'PROFILE_NOT_FOUND',
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
      typedProfile.spotify_token_expires_at === null
    ) {
      // Try to get Spotify tokens from session
      const session = await supabase.auth.getSession()
      const spotifyAccessToken = session.data.session?.provider_token as
        | string
        | undefined
      const spotifyRefreshToken = session.data.session
        ?.provider_refresh_token as string | undefined

      if (spotifyAccessToken && spotifyRefreshToken) {
        // Update the profile with tokens from session
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            spotify_access_token: spotifyAccessToken,
            spotify_refresh_token: spotifyRefreshToken,
            spotify_token_expires_at: Math.floor(Date.now() / 1000) + 3600, // Assume 1 hour
            premium_verified_at: null // Reset premium verification since we're updating tokens
          })
          .eq('id', user.id)

        if (updateError) {
          return NextResponse.json(
            {
              error: 'Failed to update user profile with session tokens',
              code: 'PROFILE_UPDATE_ERROR',
              status: 500
            },
            { status: 500 }
          )
        }

        // Return the tokens from session
        return NextResponse.json({
          access_token: spotifyAccessToken,
          refresh_token: spotifyRefreshToken,
          expires_in: 3600
        })
      } else {
        return NextResponse.json(
          {
            error: 'No Spotify access token found. Please sign in again.',
            code: 'NO_SPOTIFY_TOKEN',
            status: 400
          },
          { status: 400 }
        )
      }
    }

    // Check if token needs refresh
    const tokenExpiresAt = typedProfile.spotify_token_expires_at
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
        // Log error but continue - token refresh was successful
      }

      return NextResponse.json({
        access_token: tokenData.access_token,
        refresh_token:
          tokenData.refresh_token ?? typedProfile.spotify_refresh_token,
        expires_in: tokenData.expires_in
      })
    }

    // Token is still valid, return it
    return NextResponse.json({
      access_token: typedProfile.spotify_access_token,
      refresh_token: typedProfile.spotify_refresh_token,
      expires_in: tokenExpiresAt - Math.floor(Date.now() / 1000)
    })
  } catch {
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
