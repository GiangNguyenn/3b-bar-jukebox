import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Allow GET requests for refresh-site endpoint
  if (
    request.nextUrl.pathname === '/api/refresh-site' &&
    request.method !== 'GET'
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Method not allowed. Only GET requests are accepted.'
      },
      { status: 405 }
    )
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/refresh-site'
}
