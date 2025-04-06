import { NextResponse } from 'next/server';
import { TrackItem, SpotifyPlaylistItem, SpotifyPlaybackState } from "@/shared/types";
import { COOLDOWN_MS, MAX_PLAYLIST_LENGTH } from "@/shared/constants/trackSuggestion";
import { ERROR_MESSAGES } from "@/shared/constants/errors";
import { findSuggestedTrack, TrackSearchResult } from "@/services/trackSuggestion";
import { sendApiRequest } from "@/shared/api";
import { filterUpcomingTracks } from "@/lib/utils";
import { autoRemoveTrack } from '@/shared/utils/autoRemoveTrack';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FIXED_PLAYLIST_NAME = "3B Saigon";
const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? "";

// Custom error class for better error handling
class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Structured logging utility
interface LogData {
  [key: string]: unknown;
}

const log = {
  info: (message: string, data?: LogData) => {
    console.log('\n[INFO]', message);
    if (data) {
      console.log('Data:', JSON.stringify(data, null, 2));
    }
  },
  error: (message: string, error?: unknown) => {
    console.error('\n[ERROR]', message);
    if (error) {
      console.error('Error details:', JSON.stringify(
        error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        null,
        2
      ));
    }
  }
};

// Log environment variables at startup
console.log('\n=== Environment Check ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Spotify User ID:', userId ? 'Set' : 'Not set');
console.log('Spotify Base URL:', process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL ? 'Set' : 'Not set');
console.log('Spotify Client ID:', process.env.SPOTIFY_CLIENT_ID ? 'Set' : 'Not set');
console.log('Spotify Client Secret:', process.env.SPOTIFY_CLIENT_SECRET ? 'Set' : 'Not set');
console.log('Spotify Refresh Token:', process.env.SPOTIFY_REFRESH_TOKEN ? 'Set' : 'Not set');
console.log('========================\n');

let lastAddTime = 0;

interface SpotifyApiError {
  message: string;
  stack?: string;
  response?: {
    data?: {
      error?: {
        message: string;
      };
    };
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
    config?: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      data?: unknown;
      timeout?: number;
      withCredentials?: boolean;
      xsrfCookieName?: string;
      xsrfHeaderName?: string;
      maxContentLength?: number;
      maxBodyLength?: number;
      maxRedirects?: number;
      decompress?: boolean;
      validateStatus?: (status: number) => boolean;
    };
  };
}

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 1; // Only allow one request per minute
const requestTimestamps: number[] = [];

function isRateLimited(): boolean {
  const now = Date.now();
  // Remove timestamps older than the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  
  if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  requestTimestamps.push(now);
  return false;
}

async function getFixedPlaylist(): Promise<SpotifyPlaylistItem | null> {
  try {
    log.info('Fetching playlists to find fixed playlist', { 
      playlistName: FIXED_PLAYLIST_NAME
    });

    log.info('Making API request to fetch playlists');
    const playlists = await sendApiRequest<{ items: SpotifyPlaylistItem[] }>({
      path: "me/playlists",
    });

    log.info('Playlists fetched', { 
      totalPlaylists: playlists.items.length,
      playlistNames: playlists.items.map(p => p.name),
      playlists: playlists.items.map(p => ({ id: p.id, name: p.name }))
    });

    const fixedPlaylist = playlists.items.find(
      (playlist) => playlist.name === FIXED_PLAYLIST_NAME
    );

    if (!fixedPlaylist) {
      log.info(`No playlist found with name: ${FIXED_PLAYLIST_NAME}`, {
        availablePlaylists: playlists.items.map(p => p.name),
        expectedName: FIXED_PLAYLIST_NAME
      });
      return null;
    }

    log.info('Found fixed playlist', { 
      playlistId: fixedPlaylist.id,
      playlistName: fixedPlaylist.name
    });

    log.info('Fetching playlist details', { playlistId: fixedPlaylist.id });
    const playlist = await sendApiRequest<SpotifyPlaylistItem>({
      path: `playlists/${fixedPlaylist.id}`,
    });

    return playlist;
  } catch (error) {
    const apiError = error as SpotifyApiError;
    const errorDetails = {
      error: apiError,
      statusCode: apiError.response?.data?.error?.message,
      response: apiError.response,
      message: apiError.message,
      stack: apiError.stack,
      errorDetails: apiError.response?.data?.error,
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
      platform: process.platform,
      headers: apiError.response?.headers,
      status: apiError.response?.status,
      statusText: apiError.response?.statusText,
      config: apiError.response?.config,
      requestUrl: apiError.response?.config?.url,
      requestMethod: apiError.response?.config?.method,
      requestHeaders: apiError.response?.config?.headers,
      responseHeaders: apiError.response?.headers
    };

    log.error('Error getting fixed playlist', errorDetails);
    throw new ApiError('Failed to get fixed playlist', 500, errorDetails);
  }
}

async function getCurrentlyPlaying(): Promise<{ id: string | null; error?: string }> {
  try {
    const response = await sendApiRequest<SpotifyPlaybackState>({
      path: "me/player/currently-playing",
    });
    return { id: response.item?.id ?? null };
  } catch (error) {
    const apiError = error as SpotifyApiError;
    log.error('Error getting currently playing track', {
      error: apiError,
      statusCode: apiError.response?.data?.error?.message
    });
    
    if (apiError.response?.data?.error?.message?.includes('401')) {
      return { id: null, error: 'Spotify authentication failed. Please check your access token.' };
    }
    
    return { id: null };
  }
}

async function waitForRetry(retryCount: number): Promise<void> {
  if (retryCount < MAX_RETRIES) {
    const delay = RETRY_DELAY_MS * Math.pow(2, retryCount); // Exponential backoff
    log.info(`Waiting ${delay}ms before retry ${retryCount + 1}/${MAX_RETRIES}`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

async function tryAddTrack(trackUri: string, playlistId: string): Promise<boolean> {
  try {
    // Ensure the track URI has the correct format
    const formattedUri = trackUri.startsWith('spotify:track:') ? trackUri : `spotify:track:${trackUri}`;
    
    log.info('Attempting to add track to playlist', {
      playlistId,
      trackUri: formattedUri
    });

    await sendApiRequest({
      path: `playlists/${playlistId}/tracks`,
      method: "POST",
      body: {
        uris: [formattedUri]
      }
    });

    log.info('Successfully added track to playlist', {
      playlistId,
      trackUri: formattedUri
    });
    
    return true;
  } catch (error) {
    const apiError = error as SpotifyApiError;
    log.error('Error adding track to playlist', {
      error: apiError,
      playlistId,
      trackUri
    });
    throw error;
  }
}

async function handleTrackSuggestion(existingTrackIds: string[], retryCount: number, playlistId: string): Promise<{ success: boolean; searchDetails?: TrackSearchResult['searchDetails'] }> {
  const result = await findSuggestedTrack(existingTrackIds);
  
  if (!result.track) {
    log.info(`${ERROR_MESSAGES.NO_SUGGESTIONS} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    return { success: false, searchDetails: result.searchDetails };
  }

  log.info(`Attempting to add suggested track: ${result.track.name}`, {
    attempt: retryCount + 1,
    maxRetries: MAX_RETRIES,
    trackId: result.track.id
  });
  
  const added = await tryAddTrack(result.track.uri, playlistId);
  return { success: added, searchDetails: result.searchDetails };
}

async function addSuggestedTrackToPlaylist(upcomingTracks: TrackItem[], playlistId: string): Promise<{ success: boolean; error?: string; searchDetails?: TrackSearchResult['searchDetails'] }> {
  const existingTrackIds = upcomingTracks.map(t => t.track.id);
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
    let searchDetails: TrackSearchResult['searchDetails'] | undefined;

    while (!success && retryCount < MAX_RETRIES) {
      const result = await handleTrackSuggestion(existingTrackIds, retryCount, playlistId);
      success = result.success;
      searchDetails = result.searchDetails;
      
      if (!success) {
        console.log(`Track already exists or no suitable track found, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        retryCount++;
        await waitForRetry(retryCount);
      }
    }

    if (success) {
      lastAddTime = now;
      return { success: true, searchDetails };
    } else {
      throw new Error(ERROR_MESSAGES.MAX_RETRIES);
    }
  } catch (error) {
    const apiError = error as SpotifyApiError;
    console.error("Error getting/adding suggestion:", {
      error: apiError,
      upcomingTracksLength: upcomingTracks.length
    });
    return { success: false, error: apiError.message || ERROR_MESSAGES.GENERIC_ERROR, searchDetails: undefined };
  }
}

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get('force') === 'true';
    
    // Get the fixed playlist
    log.info('Getting fixed playlist');
    const playlist = await getFixedPlaylist();
    
    if (!playlist) {
      return NextResponse.json({ 
        success: false, 
        message: `No playlist found with name: ${FIXED_PLAYLIST_NAME}`,
        timestamp: new Date().toISOString()
      });
    }

    // Get currently playing track
    log.info('Getting currently playing track');
    const { id: currentTrackId, error: playbackError } = await getCurrentlyPlaying();
    
    if (playbackError) {
      log.error('Error getting currently playing track', { error: playbackError });
      return NextResponse.json({ 
        success: false, 
        message: playbackError,
        timestamp: new Date().toISOString()
      });
    }
    
    // Get upcoming tracks
    log.info('Filtering upcoming tracks');
    const upcomingTracks = filterUpcomingTracks(playlist.tracks.items, currentTrackId);
    
    log.info('Upcoming tracks analysis:', {
      totalTracks: playlist.tracks.items.length,
      upcomingTracksCount: upcomingTracks.length,
      currentTrackId,
      playlistTrackIds: playlist.tracks.items.map(t => t.track.id),
      upcomingTrackIds: upcomingTracks.map(t => t.track.id)
    });

    // Try to auto-remove finished tracks
    const playbackState = await sendApiRequest<SpotifyPlaybackState>({ path: "me/player" });
    const removedTrack = await autoRemoveTrack({
      playlistId: playlist.id,
      currentTrackId,
      playlistTracks: playlist.tracks.items,
      playbackState
    });
    
    // Add diagnostic information to the response
    const diagnosticInfo = {
      currentTrackId,
      totalTracks: playlist.tracks.items.length,
      upcomingTracksCount: upcomingTracks.length,
      playlistTrackIds: playlist.tracks.items.map(t => t.track.id),
      upcomingTrackIds: upcomingTracks.map(t => t.track.id),
      removedTrack
    };
    
    log.info('Adding suggested track to playlist');
    const result = await addSuggestedTrackToPlaylist(upcomingTracks, playlist.id);
    
    if (!result.success) {
      log.info('No track added to playlist', { 
        reason: result.error,
        upcomingTracksCount: upcomingTracks.length,
        maxAllowed: MAX_PLAYLIST_LENGTH
      });
      return NextResponse.json({ 
        success: true, 
        message: result.error === "Playlist too long" 
          ? `Playlist has reached maximum length of ${MAX_PLAYLIST_LENGTH} tracks. No new tracks needed.`
          : result.error,
        timestamp: new Date().toISOString(),
        diagnosticInfo,
        forceRefresh: force
      });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Track added successfully',
      timestamp: new Date().toISOString(),
      diagnosticInfo,
      forceRefresh: force
    });
  } catch (error) {
    const apiError = error as SpotifyApiError;
    log.error('Error in refresh-site endpoint', apiError);
    return NextResponse.json({ 
      success: false, 
      message: apiError.message || ERROR_MESSAGES.GENERIC_ERROR,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 