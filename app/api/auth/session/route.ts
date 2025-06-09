import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createRouteHandlerClient<Database>({ cookies })
    const {
      data: { session },
      error
    } = await supabase.auth.getSession()

    if (error) {
      console.error('Error getting session:', error)
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    return NextResponse.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.user_metadata.name,
        image: session.user.user_metadata.avatar_url
      },
      expires: session.expires_at
    })
  } catch (error) {
    console.error('Error in session route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
