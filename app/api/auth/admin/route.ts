import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(): Promise<NextResponse> {
  try {
    const supabase = createRouteHandlerClient<Database>({ cookies })

    // Check if admin profile exists
    const { data: adminProfile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('display_name', '3B')
      .single()

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('Error checking admin profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to check admin profile' },
        { status: 500 }
      )
    }

    if (adminProfile) {
      // Check if admin profile has valid tokens
      if (
        adminProfile.spotify_access_token &&
        adminProfile.spotify_refresh_token &&
        adminProfile.spotify_token_expires_at &&
        adminProfile.spotify_token_expires_at > Math.floor(Date.now() / 1000)
      ) {
        return NextResponse.json({
          message: 'Admin profile exists with valid tokens'
        })
      }

      // Refresh tokens if they're expired
      const tokenUrl = 'https://accounts.spotify.com/api/token'
      const tokenBody = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: adminProfile.spotify_refresh_token
      })
      const tokenHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`
      }

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: tokenHeaders,
        body: tokenBody
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        console.error('Error refreshing tokens:', {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          error: errorText
        })
        return NextResponse.json(
          { error: 'Failed to refresh tokens' },
          { status: 500 }
        )
      }

      const tokenData = await tokenResponse.json()

      // Update admin profile with new tokens
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: tokenData.access_token,
          spotify_token_expires_at:
            Math.floor(Date.now() / 1000) + tokenData.expires_in
        })
        .eq('display_name', '3B')

      if (updateError) {
        console.error('Error updating admin profile:', updateError)
        return NextResponse.json(
          { error: 'Failed to update admin profile' },
          { status: 500 }
        )
      }

      return NextResponse.json({ message: 'Admin profile tokens refreshed' })
    }

    // Create new admin profile
    const adminData = {
      id: 'admin',
      spotify_user_id: process.env.SPOTIFY_ADMIN_USER_ID,
      display_name: '3B',
      spotify_access_token: process.env.SPOTIFY_ADMIN_ACCESS_TOKEN,
      spotify_refresh_token: process.env.SPOTIFY_ADMIN_REFRESH_TOKEN,
      spotify_token_expires_at: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    }

    const { error: insertError } = await supabase
      .from('profiles')
      .insert(adminData)

    if (insertError) {
      console.error('Error creating admin profile:', insertError)
      return NextResponse.json(
        { error: 'Failed to create admin profile' },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: 'Admin profile created' })
  } catch (error) {
    console.error('Error in admin profile setup:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
