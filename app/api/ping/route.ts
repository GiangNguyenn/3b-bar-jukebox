import { NextResponse } from 'next/server'

export function GET(): NextResponse {
  return new NextResponse(null, { status: 200 })
}

export function HEAD(): NextResponse {
  return new NextResponse(null, { status: 200 })
}
