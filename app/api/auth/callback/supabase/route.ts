import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const error_description = requestUrl.searchParams.get('error_description')

  if (error) {
    console.error('Auth error:', { error, error_description })
    return NextResponse.redirect(
      `${requestUrl.origin}?error=${error}`
    )
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

      // Get the access token from the provider token
      const providerToken = session.provider_token
      if (!providerToken) {
        console.error('No provider token found')
        return NextResponse.redirect(
          `${requestUrl.origin}?error=No provider token found`
        )
      }

      // Update user metadata with the access token
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          access_token: providerToken
        }
      })

      if (updateError) {
        console.error('Error updating user metadata:', updateError)
        return NextResponse.redirect(
          `${requestUrl.origin}?error=${updateError.message}`
        )
      }

      // Get the user's profile to redirect to their playlist page
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', session.user.id)
        .single()

      if (profile?.display_name) {
        return NextResponse.redirect(`${requestUrl.origin}/${profile.display_name}/playlist`)
      }

      return NextResponse.redirect(requestUrl.origin)
    } catch (error) {
      console.error('Error in callback:', error)
      return NextResponse.redirect(
        `${requestUrl.origin}?error=An error occurred`
      )
    }
  }

  return NextResponse.redirect(
    `${requestUrl.origin}?error=No code provided`
  )
} 