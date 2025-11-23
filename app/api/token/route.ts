import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  refreshTokenWithRetry,
  isNetworkErrorRecoverable
} from '@/recovery/tokenRecovery'

const logger = createModuleLogger('API Token')

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

interface ErrorResponse {
  error: string
  code: string
  status: number
}

interface UserProfile {
  id: string
  spotify_access_token: string | null
  spotify_refresh_token: string | null
  spotify_token_expires_at: number | null
}

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

    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          error: 'Not authenticated',
          code: 'NOT_AUTHENTICATED',
          status: 401
        },
        { status: 401 }
      )
    }

    // Get user profile from database
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
          // Create profile with conflict handling
          const initialDisplayName =
            (user.user_metadata?.name as string | undefined) ??
            user.email?.split('@')[0] ??
            'user'

          let profileData = {
            id: user.id,
            spotify_user_id: user.id,
            display_name: initialDisplayName,
            avatar_url:
              (user.user_metadata?.avatar_url as string | undefined) ?? null,
            spotify_access_token: spotifyAccessToken,
            spotify_refresh_token: spotifyRefreshToken,
            spotify_token_expires_at: Math.floor(Date.now() / 1000) + 3600, // Assume 1 hour
            is_premium: false,
            premium_verified_at: null
          }

          // Try to insert with initial display_name
          const { error: createError } = await supabase
            .from('profiles')
            .insert(profileData)

          // If there's a unique constraint violation, use spotify_user_id as fallback
          if (
            createError &&
            createError.code === '23505' &&
            createError.message?.includes('display_name')
          ) {
            logger(
              'INFO',
              `Display name "${initialDisplayName}" is already taken, using spotify_user_id as fallback`
            )

            profileData = {
              ...profileData,
              display_name: user.id // Use user ID as display_name
            }

            const { error: fallbackError } = await supabase
              .from('profiles')
              .insert(profileData)

            if (fallbackError) {
              return NextResponse.json(
                {
                  error: 'Failed to create user profile',
                  code: 'PROFILE_CREATION_ERROR',
                  status: 500
                },
                { status: 500 }
              )
            }
          } else if (createError) {
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

      // For other profile errors, try to get tokens from session
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

    // Type guard to ensure userProfile has required fields
    const typedProfile = userProfile as UserProfile
    if (
      !typedProfile.spotify_access_token ||
      !typedProfile.spotify_refresh_token ||
      typedProfile.spotify_token_expires_at === null
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
    const tokenExpiresAt = typedProfile.spotify_token_expires_at
    const now = Math.floor(Date.now() / 1000)

    if (tokenExpiresAt && tokenExpiresAt <= now) {
      // Token is expired, refresh it
      if (!typedProfile.spotify_refresh_token) {
        logger('ERROR', 'No refresh token available')
        return NextResponse.json(
          {
            error: 'No refresh token available',
            code: 'NO_REFRESH_TOKEN',
            status: 500
          },
          { status: 500 }
        )
      }

      const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
      const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        logger('ERROR', 'Missing Spotify client credentials')
        return NextResponse.json(
          {
            error: 'Server configuration error',
            code: 'INVALID_CLIENT_CREDENTIALS',
            status: 500
          },
          { status: 500 }
        )
      }

      // Use recovery module for token refresh with retry logic
      const refreshResult = await refreshTokenWithRetry(
        typedProfile.spotify_refresh_token,
        SPOTIFY_CLIENT_ID,
        SPOTIFY_CLIENT_SECRET
      )

      if (!refreshResult.success || !refreshResult.accessToken) {
        const errorCode = refreshResult.error?.code ?? 'TOKEN_REFRESH_ERROR'
        const errorMessage =
          refreshResult.error?.message ?? 'Failed to refresh token'

        logger('ERROR', `Token refresh failed: ${errorCode} - ${errorMessage}`)

        return NextResponse.json(
          {
            error: errorMessage,
            code: errorCode,
            status: refreshResult.error?.isRecoverable ? 503 : 500
          },
          { status: refreshResult.error?.isRecoverable ? 503 : 500 }
        )
      }

      // Calculate expires_at - use refreshResult.expiresIn if available
      // If expiresIn is undefined, use a safe default (3600 seconds = 1 hour)
      // Don't use tokenExpiresAt as fallback since it's already expired (that's why we're refreshing)
      const newExpiresAt = refreshResult.expiresIn
        ? Math.floor(Date.now() / 1000) + refreshResult.expiresIn
        : Math.floor(Date.now() / 1000) + 3600 // Default to 1 hour if expiresIn is not provided

      // Update the token in the database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: refreshResult.accessToken,
          spotify_refresh_token:
            refreshResult.refreshToken ?? typedProfile.spotify_refresh_token,
          spotify_token_expires_at: newExpiresAt
        })
        .eq('id', userProfile.id)

      if (updateError) {
        logger('ERROR', 'Error updating token', JSON.stringify(updateError))
      }

      // Calculate expires_in for response - ensure it matches what's stored in database
      // Use the same default (3600 seconds) if expiresIn is not provided
      const expiresInSeconds = refreshResult.expiresIn ?? 3600

      return NextResponse.json({
        access_token: refreshResult.accessToken,
        refresh_token:
          refreshResult.refreshToken ?? typedProfile.spotify_refresh_token,
        expires_in: expiresInSeconds
      })
    }

    // Token is still valid
    return NextResponse.json({
      access_token: typedProfile.spotify_access_token,
      refresh_token: typedProfile.spotify_refresh_token,
      expires_in: tokenExpiresAt - now
    })
  } catch (error) {
    // Check if it's a network error that might be recoverable
    if (isNetworkErrorRecoverable(error)) {
      logger(
        'WARN',
        'Network error in token endpoint (potentially recoverable)',
        'Token',
        error instanceof Error ? error : undefined
      )
      return NextResponse.json(
        {
          error: 'Network error. Please try again.',
          code: 'NETWORK_ERROR',
          status: 503
        },
        { status: 503 }
      )
    }

    logger(
      'ERROR',
      'Error in token endpoint',
      'token',
      error instanceof Error ? error : undefined
    )
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
