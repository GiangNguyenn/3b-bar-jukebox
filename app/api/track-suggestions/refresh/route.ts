import { NextResponse } from 'next/server'

export function POST(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      message:
        'This endpoint is deprecated. Use the main playlist refresh endpoint instead.'
    },
    { status: 410 }
  )
}
