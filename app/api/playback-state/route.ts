import { NextResponse } from 'next/server';
import { sendApiRequest } from '@/shared/api';
import { SpotifyPlaybackState } from '@/shared/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const playbackState = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET',
    });

    return NextResponse.json(playbackState);
  } catch (error) {
    console.error('Error fetching playback state:', error);
    return NextResponse.json(
      { error: 'Failed to fetch playback state' },
      { status: 500 }
    );
  }
} 