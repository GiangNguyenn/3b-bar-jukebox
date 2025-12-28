import { NextResponse } from 'next/server'
import { createModuleLogger } from '@/shared/utils/logger'
import { supabase } from '@/lib/supabase'

const logger = createModuleLogger('API Genres')

export const runtime = 'nodejs'
// Cache for 1 hour since genres don't change often
export const revalidate = 3600

export async function GET(): Promise<NextResponse> {
  try {
    // Determine which Supabase client to use
    // Using the one imported from lib/supabase which should be configured server-side

    // Use the RPC function for efficient unique genre retrieval
    const { data, error } = await supabase.rpc('get_unique_genres')

    if (error) {
      throw error
    }

    if (!data) {
      return NextResponse.json({ success: true, genres: [] })
    }

    // RPC already returns distinct, sorted values if implemented as such
    // but it doesn't hurt to sort once more for safety
    const genres = (data as { genre: string }[]).map((row) => row.genre)

    return NextResponse.json({
      success: true,
      genres: genres
    })
  } catch (error) {
    logger('ERROR', `[Genres API] Error: ${JSON.stringify(error)}`)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
