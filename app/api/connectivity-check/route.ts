import { NextRequest, NextResponse } from 'next/server'

/**
 * Enhanced connectivity check endpoint
 * Supports protocol-specific testing (IPv4/IPv6)
 */
export function GET(request: NextRequest): NextResponse {
  const searchParams = request.nextUrl.searchParams
  const protocol = searchParams.get('protocol') // 'ipv4' | 'ipv6' | null

  // Get edge region from Vercel headers
  const edgeRegion =
    request.headers.get('x-vercel-id')?.split('::')[0] ?? 'unknown'

  // Detect connection protocol from request
  const forwardedFor = request.headers.get('x-forwarded-for')
  const detectedProtocol = forwardedFor?.includes(':') ? 'ipv6' : 'ipv4'

  return NextResponse.json(
    {
      success: true,
      protocol: protocol ?? detectedProtocol,
      edgeRegion,
      timestamp: Date.now()
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Edge-Region': edgeRegion,
        'X-Connection-Protocol': detectedProtocol
      }
    }
  )
}

export function HEAD(request: NextRequest): NextResponse {
  const edgeRegion =
    request.headers.get('x-vercel-id')?.split('::')[0] ?? 'unknown'
  const forwardedFor = request.headers.get('x-forwarded-for')
  const detectedProtocol = forwardedFor?.includes(':') ? 'ipv6' : 'ipv4'

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Edge-Region': edgeRegion,
      'X-Connection-Protocol': detectedProtocol
    }
  })
}
