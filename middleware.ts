import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Only run on the first request to the app
  if (request.cookies.has('admin_profile_checked')) {
    return NextResponse.next()
  }

  try {
    // Call the admin profile setup endpoint
    const response = await fetch(`${request.nextUrl.origin}/api/auth/admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      console.error('Failed to setup admin profile:', await response.text())
    }
  } catch (error) {
    console.error('Error setting up admin profile:', error)
  }

  // Set a cookie to indicate we've checked for the admin profile
  const response = NextResponse.next()
  response.cookies.set('admin_profile_checked', 'true', {
    maxAge: 60 * 60 * 24 // 24 hours
  })

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
