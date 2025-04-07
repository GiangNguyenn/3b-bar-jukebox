import { NextResponse } from 'next/server';
import { sendApiRequest } from '@/shared/api';

export async function POST(request: Request) {
  try {
    const { action, contextUri, deviceId } = await request.json();
    console.log('[API Playback] Request received:', { action, contextUri, deviceId });

    if (!deviceId) {
      console.log('[API Playback] No device ID provided');
      return NextResponse.json(
        { error: 'No active Spotify device found. Please wait for the player to initialize.' },
        { status: 400 }
      );
    }

    // Get current playback state first
    let currentState;
    try {
      currentState = await sendApiRequest({
        path: 'me/player',
        method: 'GET',
      });
      console.log('[API Playback] Current playback state:', currentState);
    } catch (error) {
      console.error('[API Playback] Error getting playback state:', error);
      // Don't throw here, continue with the playback attempt
    }

    if (action === 'play') {
      console.log('[API Playback] Starting playback on device:', deviceId);
      
      // Transfer playback to our web player first
      try {
        const transferResponse = await sendApiRequest({
          path: 'me/player',
          method: 'PUT',
          body: {
            device_ids: [deviceId],
            play: false // Don't auto-play yet
          },
        });
        console.log('[API Playback] Transfer response:', transferResponse);

        // Wait a bit for the device transfer to take effect
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Then start playback with the playlist
        const playResponse = await sendApiRequest({
          path: 'me/player/play',
          method: 'PUT',
          body: contextUri ? { context_uri: contextUri } : {},
        });
        console.log('[API Playback] Play response:', playResponse);

      } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error';
        console.error('[API Playback] Detailed playback error:', {
          message: errorMessage,
          error,
          deviceId,
          contextUri
        });
        
        // Return a more specific error message
        return NextResponse.json(
          { 
            error: `Failed to control playback: ${errorMessage}`,
            details: error?.response?.data || error?.response || error
          },
          { status: 500 }
        );
      }
    } else if (action === 'skip') {
      try {
        // The skip endpoint returns 204 No Content, so we don't need to parse the response
        await sendApiRequest({
          path: 'me/player/next',
          method: 'POST',
        });
        console.log('[API Playback] Skip request successful');
      } catch (error: any) {
        console.error('[API Playback] Skip error:', error);
        return NextResponse.json(
          { 
            error: `Failed to skip track: ${error?.message || 'Unknown error'}`,
            details: error?.response?.data || error?.response || error
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API Playback] Top level error:', {
      error,
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      response: error?.response?.data
    });
    return NextResponse.json(
      { 
        error: `Playback control failed: ${error?.message || 'Unknown error'}`,
        details: error?.response?.data || error?.response || error
      },
      { status: 500 }
    );
  }
} 