import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

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
          console.log(
            'Non-premium user accessing admin route, redirecting to premium required page'
          )
          // Non-premium user, redirect to premium required page
          const redirectUrl = new URL('/premium-required', request.url)
          return NextResponse.redirect(redirectUrl)
        }
      } else {
        // Premium verification failed, check if it's a token issue
        const errorData = await premiumResponse.json().catch(() => ({}))
        console.error('Premium verification failed in middleware:', {
          status: premiumResponse.status,
          error: errorData
        })

        // If it's a token issue, redirect to sign in
        if (
          premiumResponse.status === 401 ||
          errorData.code === 'NO_SPOTIFY_TOKEN' ||
          errorData.code === 'INVALID_SPOTIFY_TOKEN'
        ) {
          console.log('Token issue detected, redirecting to sign in')
          const redirectUrl = new URL('/auth/signin', request.url)
          return NextResponse.redirect(redirectUrl)
        }

        // Other errors, redirect to premium required page
        const redirectUrl = new URL('/premium-required', request.url)
        return NextResponse.redirect(redirectUrl)
      }
    } catch (error) {
      console.error('Error verifying premium status in middleware:', error)
      // Error in premium verification, redirect to premium required page
      const redirectUrl = new URL('/premium-required', request.url)
      return NextResponse.redirect(redirectUrl)
    }

    console.log(
      'Admin route accessed by authenticated premium user:',
      request.nextUrl.pathname
    )
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
