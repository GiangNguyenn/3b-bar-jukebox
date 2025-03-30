import { NextResponse } from 'next/server';
import { TrackItem, SpotifyPlaylistItem, SpotifyPlaybackState } from "@/shared/types";
import { COOLDOWN_MS, MAX_PLAYLIST_LENGTH } from "@/shared/constants/trackSuggestion";
import { ERROR_MESSAGES } from "@/shared/constants/errors";
import { findSuggestedTrack } from "@/services/trackSuggestion";
import { sendApiRequest } from "@/shared/api";
import { formatDateForPlaylist } from "@/shared/utils/date";
import { filterUpcomingTracks } from "@/lib/utils";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

async function getTodayPlaylist(): Promise<SpotifyPlaylistItem | null> {
  try {
    const todayString = formatDateForPlaylist();
    const name = `Daily Mix - ${todayString}`;
    
    // Get all playlists
    const playlists = await sendApiRequest<{ items: SpotifyPlaylistItem[] }>({
      path: "me/playlists",
    });

    // Find today's playlist
    const todayPlaylist = playlists.items.find(
      (playlist) => playlist.name === name
    );

    if (!todayPlaylist) {
      console.log(`[Refresh Site API] No playlist found for today: ${name}`);
      return null;
    }

    // Get full playlist details
    const playlist = await sendApiRequest<SpotifyPlaylistItem>({
      path: `users/${userId}/playlists/${todayPlaylist.id}`,
    });

    return playlist;
  } catch (error: any) {
    console.error("[Refresh Site API] Error getting today's playlist:", error);
    return null;
  }
}

async function getCurrentlyPlaying(): Promise<string | null> {
  try {
    const response = await sendApiRequest<SpotifyPlaybackState>({
      path: "me/player/currently-playing",
    });
    return response.item?.id ?? null;
  } catch (error: any) {
    console.error("[Refresh Site API] Error getting currently playing track:", error);
    return null;
  }
}

async function waitForRetry(retryCount: number): Promise<void> {
  if (retryCount < MAX_RETRIES) {
    console.log(`Waiting ${RETRY_DELAY_MS}ms before retrying...`);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

async function tryAddTrack(trackUri: string, playlistId: string): Promise<boolean> {
  try {
    await sendApiRequest({
      path: `playlists/${playlistId}/tracks`,
      method: "POST",
      body: JSON.stringify({
        uris: [trackUri],
      }),
    });
    return true;
  } catch (error: any) {
    if (error.message?.includes(ERROR_MESSAGES.TRACK_EXISTS)) {
      return false;
    }
    throw new Error(error.message || ERROR_MESSAGES.GENERIC_ERROR);
  }
}

async function handleTrackSuggestion(existingTrackIds: string[], retryCount: number, playlistId: string): Promise<boolean> {
  const selectedTrack = await findSuggestedTrack(existingTrackIds);
  
  if (!selectedTrack) {
    console.log(`${ERROR_MESSAGES.NO_SUGGESTIONS} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    return false;
  }

  console.log(`Attempting to add suggested track: ${selectedTrack.name} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
  return await tryAddTrack(selectedTrack.uri, playlistId);
}

async function addSuggestedTrackToPlaylist(upcomingTracks: TrackItem[], playlistId: string): Promise<{ success: boolean; error?: string }> {
  const existingTrackIds = upcomingTracks.map(t => t.track.id);
  let lastAddTime = 0;

  const now = Date.now();
  
  // Skip if in cooldown period
  if (now - lastAddTime < COOLDOWN_MS) {
    console.log("Still in cooldown period. Skipping suggestion.");
    return { success: false, error: "In cooldown period" };
  }

  // Skip if playlist is too long
  if (upcomingTracks.length > MAX_PLAYLIST_LENGTH) {
    console.log(`No need to add suggestion - playlist has more than ${MAX_PLAYLIST_LENGTH} tracks`);
    return { success: false, error: "Playlist too long" };
  }

  try {
    let retryCount = 0;
    let success = false;

    while (!success && retryCount < MAX_RETRIES) {
      success = await handleTrackSuggestion(existingTrackIds, retryCount, playlistId);
      
      if (!success) {
        console.log(`Track already exists or no suitable track found, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        retryCount++;
        await waitForRetry(retryCount);
      }
    }

    if (success) {
      lastAddTime = Date.now();
      return { success: true };
    } else {
      throw new Error(ERROR_MESSAGES.MAX_RETRIES);
    }
  } catch (err: any) {
    console.error("Error getting/adding suggestion:", {
      error: err,
      upcomingTracksLength: upcomingTracks.length,
    });
    return { success: false, error: err.message || ERROR_MESSAGES.GENERIC_ERROR };
  }
}

export async function POST(request: Request) {
  try {
    // Verify cron job secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Unauthorized' 
        },
        { status: 401 }
      );
    }

    console.log('[Refresh Site API] Endpoint called');
    
    // Get today's playlist
    const playlist = await getTodayPlaylist();
    if (!playlist) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'No playlist found for today' 
        },
        { status: 404 }
      );
    }

    // Get currently playing track
    const currentTrackId = await getCurrentlyPlaying();
    
    // Get upcoming tracks
    const upcomingTracks = filterUpcomingTracks(playlist.tracks.items, currentTrackId);
    
    const result = await addSuggestedTrackToPlaylist(upcomingTracks, playlist.id);
    
    if (!result.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Failed to add suggested track' 
        },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Successfully added suggested track',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Refresh Site API] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to refresh site' 
      },
      { status: 500 }
    );
  }
} 