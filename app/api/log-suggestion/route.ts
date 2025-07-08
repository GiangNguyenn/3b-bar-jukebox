import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const logSuggestionSchema = z.object({
  profile_id: z.string().uuid(),
  track: z.object({
    id: z.string(),
    name: z.string(),
    artists: z.array(z.object({ name: z.string(), genres: z.array(z.string()).optional() })),
    album: z.object({
      name: z.string(),
      release_date: z.string(),
    }),
    duration_ms: z.number(),
    popularity: z.number(),
    external_urls: z.object({ spotify: z.string() }),
  }),
});

export async function POST(request: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  try {
    const body = await request.json();
    const { profile_id, track } = logSuggestionSchema.parse(body);

    const { error } = await supabase.rpc('log_track_suggestion', {
      p_profile_id: profile_id,
      p_spotify_track_id: track.id,
      p_track_name: track.name,
      p_artist_name: track.artists[0]?.name ?? 'Unknown Artist',
      p_album_name: track.album.name,
      p_duration_ms: track.duration_ms,
      p_popularity: track.popularity,
      p_spotify_url: track.external_urls.spotify,
      p_genre: track.artists[0]?.genres?.[0] ?? null,
      p_release_year: new Date(track.album.release_date).getFullYear(),
    });

    if (error) {
      console.error('Error logging track suggestion:', error);
      return NextResponse.json(
        { error: 'Internal Server Error', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Suggestion logged successfully' },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    console.error('Unexpected error in log-suggestion:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}