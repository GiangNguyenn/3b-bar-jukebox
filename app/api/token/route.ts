/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

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
          const initialDisplayName = (user.user_metadata?.name as string | undefined) ??
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
          if (createError && createError.code === '23505' && createError.message?.includes('display_name')) {
            logger('INFO', `Display name "${initialDisplayName}" is already taken, using spotify_user_id as fallback`)
            
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

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: typedProfile.spotify_refresh_token
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger('ERROR', 'Error refreshing token', errorText)
        return NextResponse.json(
          {
            error: 'Failed to refresh token',
            code: 'TOKEN_REFRESH_ERROR',
            status: 500
          },
          { status: 500 }
        )
      }

      const tokenData = (await response.json()) as {
        access_token: string
        expires_in: number
      }

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
        logger('ERROR', 'Error updating token', JSON.stringify(updateError))
      }

      return NextResponse.json({
        access_token: tokenData.access_token,
        refresh_token: typedProfile.spotify_refresh_token,
        expires_in: tokenData.expires_in
      })
    }

    // Token is still valid
    return NextResponse.json({
      access_token: typedProfile.spotify_access_token,
      refresh_token: typedProfile.spotify_refresh_token,
      expires_in: tokenExpiresAt - now
    })
  } catch (error) {
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
