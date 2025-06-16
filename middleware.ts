import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/types/supabase'

export async function middleware(request: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient<Database>({ req: request, res })

  // Check if this is an admin route
  const isAdminRoute = request.nextUrl.pathname.includes('/admin')

  if (isAdminRoute) {
    const {
      data: { session }
    } = await supabase.auth.getSession()

    // If no session, redirect to login
    if (!session) {
      const redirectUrl = new URL('/login', request.url)
      return NextResponse.redirect(redirectUrl)
    }

    // Get the username from the URL
    const username = request.nextUrl.pathname.split('/')[1]

    // Get the user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', session.user.id)
      .single()

    // If the username in the URL doesn't match the user's display_name, redirect to their admin page
    if (profile?.display_name && profile.display_name !== username) {
      const redirectUrl = new URL(`/${profile.display_name}/admin`, request.url)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Only run profile check on the first request to the app
  if (request.cookies.has('profile_checked')) {
    return res
  }

  try {
    // Call the profile setup endpoint
    const response = await fetch(`${request.nextUrl.origin}/api/auth/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      console.error('Failed to setup profile:', await response.text())
    }
  } catch (error) {
    console.error('Error setting up profile:', error)
  }

  // Set a cookie to indicate we've checked for the profile
  res.cookies.set('profile_checked', 'true', {
    maxAge: 60 * 60 * 24 // 24 hours
  })

  return res
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
