import { NextResponse } from 'next/server';
import { sendApiRequest } from '@/shared/api';
import { SpotifyPlaybackState } from '@/shared/types';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function verifyDeviceActive(deviceId: string): Promise<boolean> {
  try {
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET',
    });
    return state?.device?.id === deviceId;
  } catch (error) {
    console.error('[API Playback] Error verifying device:', error);
    return false;
  }
}

async function transferPlaybackToDevice(deviceId: string, retryCount = 0): Promise<void> {
  try {
    // First verify the device is still active
    const isDeviceActive = await verifyDeviceActive(deviceId);
    if (!isDeviceActive) {
      throw new Error('Device is no longer active');
    }
    
    await sendApiRequest({
      path: 'me/player',
      method: 'PUT',
      body: {
        device_ids: [deviceId],
        play: false
      },
    });

    // Verify the transfer was successful
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET',
    });

    if (state?.device?.id !== deviceId) {
      throw new Error('Device transfer verification failed');
    }
  } catch (error) {
    console.error(`[API Playback] Transfer attempt ${retryCount + 1} failed:`, error);
    
    if (retryCount < MAX_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return transferPlaybackToDevice(deviceId, retryCount + 1);
    }
    
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const { action, contextUri, deviceId } = await request.json();

    if (!deviceId) {
      return NextResponse.json(
        { error: 'No active Spotify device found. Please wait for the player to initialize.' },
        { status: 400 }
      );
    }

    // Verify the device is still active before proceeding
    const isDeviceActive = await verifyDeviceActive(deviceId);
    if (!isDeviceActive) {
      return NextResponse.json(
        { error: 'The Spotify player is no longer active. Please refresh the page and try again.' },
        { status: 400 }
      );
    }

    // Get current playback state first
    let currentState: SpotifyPlaybackState | null = null;
    try {
      currentState = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET',
      });
    } catch (error) {
      console.error('[API Playback] Error getting playback state:', error);
      // Don't throw here, continue with the playback attempt
    }

    if (action === 'play') {
      try {
        // Transfer playback to our web player with retries
        await transferPlaybackToDevice(deviceId);

        // Wait a bit for the device transfer to take effect
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Then start playback with the playlist
        const playResponse = await sendApiRequest({
          path: 'me/player/play',
          method: 'PUT',
          body: contextUri ? { context_uri: contextUri } : {},
        });

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