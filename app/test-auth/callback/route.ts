import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')

  if (error) {
    console.error('Auth error:', { error, errorDescription })
    return NextResponse.redirect(
      `${requestUrl.origin}/test-auth?error=${encodeURIComponent(errorDescription || error)}`
    )
  }

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    try {
      await supabase.auth.exchangeCodeForSession(code)
      return NextResponse.redirect(`${requestUrl.origin}/test-auth`)
    } catch (error) {
      console.error('Error exchanging code for session:', error)
      return NextResponse.redirect(
        `${requestUrl.origin}/test-auth?error=${encodeURIComponent('Failed to exchange code for session')}`
      )
    }
  }

  // If no code or error, redirect back to the test page
  return NextResponse.redirect(`${requestUrl.origin}/test-auth`)
}
