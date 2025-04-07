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

    console.log('Request URL:', request.url);
    console.log('URL object:', url);
    console.log('Force param:', forceParam);
    console.log('Should force:', shouldForce);

    const result = await PlaylistRefreshServiceImpl.getInstance().refreshPlaylist(shouldForce);
    
    // If refresh was successful, trigger a player state refresh
    if (result.success) {
      console.log('Playlist refresh successful, triggering player state refresh');
      
      try {
        // Get the current playback state
        const playbackState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET',
        });

        // If there's an active device, refresh its state
        if (playbackState?.device?.id) {
          console.log('Found active device, refreshing state');
          // Transfer playback to the same device to refresh its state
          await sendApiRequest({
            path: 'me/player',
            method: 'PUT',
            body: {
              device_ids: [playbackState.device.id],
              play: false // Don't auto-play
            },
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