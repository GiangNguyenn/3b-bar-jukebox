import { NextResponse } from 'next/server';
import { SpotifyApiService } from '@/services/spotifyApi';
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh';

const spotifyApi = SpotifyApiService.getInstance();
const playlistRefreshService = PlaylistRefreshServiceImpl.getInstance();

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('force') === 'true';
  const result = await playlistRefreshService.refreshPlaylist(force);
  
  return NextResponse.json(result, { 
    status: result.success ? 200 : 500 
  });
} 