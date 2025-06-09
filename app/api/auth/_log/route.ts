import { NextResponse } from 'next/server'

export async function POST(): Promise<NextResponse> {
  // This is a no-op route to handle auth logging requests
  return NextResponse.json({ success: true })
}
