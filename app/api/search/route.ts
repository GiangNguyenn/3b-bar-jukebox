import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const type = searchParams.get('type') || 'track'

  if (!query) {
    return NextResponse.json(
      { error: 'Query parameter is required' },
      { status: 400 }
    )
  }

  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Get admin profile from database
    const { data: adminProfile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .eq('display_name', '3B')
      .single()

    if (profileError || !adminProfile) {
      console.error('[Search] Error fetching admin profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to get admin credentials' },
        { status: 500 }
      )
    }

    // Check if token needs refresh
    const tokenExpiresAt = new Date(adminProfile.spotify_token_expires_at)
    const now = new Date()
    let accessToken = adminProfile.spotify_access_token

    if (tokenExpiresAt <= now) {
      // Token is expired, refresh it
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
          refresh_token: adminProfile.spotify_refresh_token
        })
      })

      if (!response.ok) {
        console.error('[Search] Error refreshing token:', await response.text())
        return NextResponse.json(
          { error: 'Failed to refresh token' },
          { status: 500 }
        )
      }

      const data = await response.json()
      accessToken = data.access_token

      // Update the token in the database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: data.access_token,
          spotify_token_expires_at: new Date(
            Date.now() + data.expires_in * 1000
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
        { error: 'Failed to search Spotify' },
        { status: searchResponse.status }
      )
    }

    const searchData = await searchResponse.json()
    return NextResponse.json(searchData)
  } catch (error) {
    console.error('[Search] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
