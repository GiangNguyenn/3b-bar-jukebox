import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const error_description = requestUrl.searchParams.get('error_description')

  console.log('Callback received:', {
    code: code ? '***' : null,
    error,
    error_description,
    url: requestUrl.toString()
  })

  if (error) {
    console.error('Auth error:', { error, error_description })
    return NextResponse.redirect(`${requestUrl.origin}?error=${error}`)
  }

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })

    try {
      // Exchange the code for a session
      const {
        data: { session },
        error: sessionError
      } = await supabase.auth.exchangeCodeForSession(code)

      if (sessionError || !session) {
        console.error('Session error:', sessionError)
        return NextResponse.redirect(
          `${requestUrl.origin}?error=${sessionError?.message || 'No session'}`
        )
      }

      // Debug log the session data
      console.log('Full session data:', JSON.stringify(session, null, 2))
      console.log(
        'User metadata:',
        JSON.stringify(session.user.user_metadata, null, 2)
      )
      console.log('Raw user data:', JSON.stringify(session.user, null, 2))

      // Exchange the code for Spotify tokens
      const tokenUrl = 'https://accounts.spotify.com/api/token'
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${requestUrl.origin}/api/auth/callback/supabase`
      })
      const tokenHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`
      }

      console.log('Making token request:', {
        url: tokenUrl,
        headers: {
          ...tokenHeaders,
          Authorization: '***'
        },
        body: {
          grant_type: 'authorization_code',
          code: '***',
          redirect_uri: tokenBody.get('redirect_uri')
        }
      })

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: tokenHeaders,
        body: tokenBody
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        console.error('Error exchanging code for tokens:', {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          error: errorText
        })
        return NextResponse.redirect(
          `${requestUrl.origin}?error=Failed to exchange code for tokens`
        )
      }

      const tokenData = await tokenResponse.json()
      console.log('Token response:', {
        ...tokenData,
        access_token: '***',
        refresh_token: '***'
      })

      // Create or update profile with tokens
      const profileData = {
        id: session.user.id,
        spotify_user_id: session.user.user_metadata.provider_id,
        display_name: session.user.user_metadata.name,
        avatar_url: session.user.user_metadata.avatar_url,
        spotify_access_token: tokenData.access_token,
        spotify_refresh_token: tokenData.refresh_token,
        spotify_token_expires_at:
          Math.floor(Date.now() / 1000) + tokenData.expires_in
      }

      console.log('Attempting to upsert profile with data:', {
        ...profileData,
        spotify_access_token: '***',
        spotify_refresh_token: '***'
      })

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(profileData)

      if (profileError) {
        console.error('Error creating/updating profile:', profileError)
        return NextResponse.redirect(
          `${requestUrl.origin}?error=${profileError.message}`
        )
      }

      // Verify the profile was updated
      const { data: updatedProfile, error: verifyError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (verifyError) {
        console.error('Error verifying profile update:', verifyError)
      } else {
        console.log('Profile after update:', {
          ...updatedProfile,
          spotify_access_token: updatedProfile?.spotify_access_token
            ? '***'
            : null,
          spotify_refresh_token: updatedProfile?.spotify_refresh_token
            ? '***'
            : null
        })
      }

      return NextResponse.redirect(requestUrl.origin)
    } catch (error) {
      console.error('Error in callback:', error)
      return NextResponse.redirect(
        `${requestUrl.origin}?error=${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  return NextResponse.redirect(requestUrl.origin)
}
