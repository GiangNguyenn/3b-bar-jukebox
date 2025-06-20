import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
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
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
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
      const premiumResponse = await fetch(`${request.nextUrl.origin}/api/auth/verify-premium`, {
        headers: {
          'Cookie': request.headers.get('cookie') || ''
        }
      })

      if (premiumResponse.ok) {
        const premiumData = await premiumResponse.json()
        if (!premiumData.isPremium) {
          // Non-premium user, redirect to premium required page
          const redirectUrl = new URL('/premium-required', request.url)
          return NextResponse.redirect(redirectUrl)
        }
      } else {
        // Premium verification failed, redirect to premium required page
        const redirectUrl = new URL('/premium-required', request.url)
        return NextResponse.redirect(redirectUrl)
      }
    } catch (error) {
      console.error('Error verifying premium status in middleware:', error)
      // Error in premium verification, redirect to premium required page
      const redirectUrl = new URL('/premium-required', request.url)
      return NextResponse.redirect(redirectUrl)
    }

    console.log('Admin route accessed by authenticated premium user:', request.nextUrl.pathname)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)'
  ]
}
