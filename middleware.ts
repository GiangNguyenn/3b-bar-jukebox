import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

// Set up logger for this module
const logger = createModuleLogger('Middleware')

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers
    }
  })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({
            request: {
              headers: request.headers
            }
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        }
      }
    }
  )

  // Check if this is an admin route
  const isAdminRoute = request.nextUrl.pathname.includes('/admin')

  if (isAdminRoute) {
    const {
      data: { session }
    } = await supabase.auth.getSession()

    // If no session, redirect to login
    if (!session) {
      const redirectUrl = new URL('/auth/signin', request.url)
      return NextResponse.redirect(redirectUrl)
    }

    // Check premium status for admin routes
    try {
      const premiumResponse = await fetch(
        `${request.nextUrl.origin}/api/auth/verify-premium`,
        {
          headers: {
            Cookie: request.headers.get('cookie') || ''
          }
        }
      )

      if (premiumResponse.ok) {
        const premiumData = await premiumResponse.json()
        if (!premiumData.isPremium) {
          // Non-premium user, redirect to premium required page
          const redirectUrl = new URL('/premium-required', request.url)
          return NextResponse.redirect(redirectUrl)
        }
      } else {
        // Premium verification failed, check if it's a token issue
        const errorData = await premiumResponse.json().catch(() => ({}))
        logger(
          'ERROR',
          `Premium verification failed in middleware: ${JSON.stringify({ status: premiumResponse.status, error: errorData })}`
        )

        // For all errors (including token issues), redirect to root page
        // This allows users to re-authenticate with Spotify
        const redirectUrl = new URL('/', request.url)
        return NextResponse.redirect(redirectUrl)
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error verifying premium status in middleware:',
        undefined,
        error instanceof Error ? error : undefined
      )
      // Error in premium verification, redirect to root page
      const redirectUrl = new URL('/', request.url)
      return NextResponse.redirect(redirectUrl)
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Only match admin routes to prevent interference with OAuth flow
     */
    '/:username/admin/:path*'
  ]
}
