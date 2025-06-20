import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

// Types
interface SpotifyTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
  scope: string
}

interface AdminProfile {
  spotify_access_token: string
  spotify_refresh_token: string
  spotify_token_expires_at: string
  spotify_client_id: string
  spotify_client_secret: string
}

interface ErrorResponse {
  error: string
  code: string
  status: number
}

interface SearchResponse {
  tracks?: {
    items: Array<{
      id: string
      name: string
      artists: Array<{
        id: string
        name: string
      }>
      album: {
        id: string
        name: string
        images: Array<{
          url: string
          height: number
          width: number
        }>
      }
    }>
  }
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  request: Request
): Promise<NextResponse<SearchResponse | ErrorResponse>> {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const type = searchParams.get('type') ?? 'track'

  if (!query) {
    return NextResponse.json(
      {
        error: 'Query parameter is required',
        code: 'MISSING_QUERY',
        status: 400
      },
      { status: 400 }
    )
  }

  try {
    const cookieStore = await cookies()

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
          },
        },
      }
    )

    // Get admin profile from database
    const { data: adminProfile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'spotify_access_token, spotify_refresh_token, spotify_token_expires_at, spotify_client_id, spotify_client_secret'
      )
      .eq('display_name', '3B')
      .single()

    if (profileError || !adminProfile) {
      console.error('[Search] Error fetching admin profile:', profileError)
      return NextResponse.json(
        {
          error: 'Failed to get admin credentials',
          code: 'ADMIN_PROFILE_ERROR',
          status: 500
        },
        { status: 500 }
      )
    }

    const typedProfile = adminProfile as AdminProfile

    // Check if token needs refresh
    const tokenExpiresAt = new Date(typedProfile.spotify_token_expires_at)
    const now = new Date()
    let accessToken = typedProfile.spotify_access_token

    if (tokenExpiresAt <= now) {
      // Token is expired, refresh it
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${typedProfile.spotify_client_id}:${typedProfile.spotify_client_secret}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: typedProfile.spotify_refresh_token
        })
      })

      if (!response.ok) {
        console.error('[Search] Error refreshing token:', await response.text())
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
      accessToken = tokenData.access_token

      // Update the token in the database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: tokenData.access_token,
          spotify_token_expires_at: new Date(
            Date.now() + tokenData.expires_in * 1000
          ).toISOString()
        })
        .eq('display_name', '3B')

      if (updateError) {
        console.error('[Search] Error updating token:', updateError)
      }
    }

    // Make the search request to Spotify API
    const searchResponse = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=${type}&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )

    if (!searchResponse.ok) {
      console.error('[Search] Spotify API error:', await searchResponse.text())
      return NextResponse.json(
        {
          error: 'Failed to search Spotify',
          code: 'SPOTIFY_API_ERROR',
          status: searchResponse.status
        },
        { status: searchResponse.status }
      )
    }

    const searchData = (await searchResponse.json()) as SearchResponse
    return NextResponse.json(searchData)
  } catch (error) {
    console.error('[Search] Error:', error)
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
