export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh';
import { AppError } from '@/shared/utils/errorHandling';
import { sendApiRequest } from '@/shared/api';
import { SpotifyPlaybackState } from '@/shared/types';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceParam = url.searchParams.get('force');
    const shouldForce = forceParam === 'true';

    const result = await PlaylistRefreshServiceImpl.getInstance().refreshPlaylist(shouldForce);
    
    // Only refresh player state if the playlist was actually updated
    if (result.success && result.diagnosticInfo?.removedTrack) {
      console.log('Playlist was updated, refreshing player state');
      
      try {
        // Get the current playback state
        const playbackState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET',
        });

        // If there's an active device and it's currently playing
        if (playbackState?.device?.id && playbackState.is_playing) {
          console.log('Found active playing device, refreshing state');
          
          // Instead of transferring playback, just seek to current position
          const currentPosition = playbackState.progress_ms;
          await sendApiRequest({
            path: `me/player/seek?position_ms=${currentPosition}`,
            method: 'PUT'
          });
        }

        result.playerStateRefresh = true;
      } catch (error) {
        console.error('Error refreshing player state:', error);
        // Don't fail the request if player refresh fails
      }
    }
    
    return NextResponse.json(result, {
      status: result.success ? 200 : 500
    });
  } catch (error) {
    console.error('Error in refresh route:', error);
    return NextResponse.json({ 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { 
      status: 500 
    });
  }
} 