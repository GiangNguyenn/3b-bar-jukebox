import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Allow both GET and POST requests for refresh-site endpoint
  if (
    request.nextUrl.pathname === '/api/track-suggestions/refresh-site' &&
    !['GET', 'POST'].includes(request.method)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Method not allowed. Only GET and POST requests are accepted.'
      },
      { status: 405 }
    )
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/track-suggestions/refresh-site'
}
