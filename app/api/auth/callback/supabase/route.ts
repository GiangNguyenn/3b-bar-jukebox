/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { getBaseUrl } from '@/shared/utils/domain'

// Validate environment variables
function validateEnv(): void {
  const requiredEnvVars = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }

  const missingVars = Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`
    )
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  console.log('[Callback] Starting callback handler')
  console.log('[Callback] Request URL:', request.url)
  console.log(
    '[Callback] Request headers:',
    Object.fromEntries(request.headers.entries())
  )

  try {
    validateEnv()

    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const error = requestUrl.searchParams.get('error')
    const error_description = requestUrl.searchParams.get('error_description')

    console.log('[Callback] URL parameters:', {
      hasCode: !!code,
      error,
      error_description,
      url: requestUrl.toString()
    })

    // Handle OAuth errors
    if (error) {
      console.log('[Callback] OAuth error:', { error, error_description })
      return NextResponse.json(
        {
          error: error_description ?? error,
          code: 'OAUTH_ERROR',
          status: 400
        },
        { status: 400 }
      )
    }

    if (!code) {
      console.log('[Callback] No authorization code')
      return NextResponse.json(
        {
          error: 'No authorization code',
          code: 'NO_CODE',
          status: 400
        },
        { status: 400 }
      )
    }

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

    console.log('[Callback] Exchanging code for session')
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.exchangeCodeForSession(code)

    if (sessionError || !session) {
      console.error('[Callback] Session exchange failed:', sessionError)
      return NextResponse.json(
        {
          error: sessionError?.message ?? 'Failed to exchange code for session',
          code: 'SESSION_ERROR',
          status: 401
        },
        { status: 401 }
      )
    }

    console.log('[Callback] Session exchange successful, redirecting to admin')

    // Use the domain utility to get the correct base URL for redirects
    const baseUrl = getBaseUrl()
    console.log('[Callback] Using base URL for redirect:', baseUrl)

    // Redirect to admin page
    const redirectUrl = new URL(
      `/${session.user.user_metadata?.name ?? 'admin'}/admin`,
      baseUrl
    )
    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error('[Callback] Unexpected error:', error)
    return NextResponse.json(
      {
        error: 'Unexpected error during authentication',
        code: 'UNEXPECTED_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
