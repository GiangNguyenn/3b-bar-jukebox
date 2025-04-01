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

async function getTodayPlaylist(): Promise<SpotifyPlaylistItem | null> {
  try {
    const todayString = formatDateForPlaylist();
    const name = `Daily Mix - ${todayString}`;
    
    log.info('Fetching playlists', { 
      todayString, 
      name,
      userId,
      baseUrl: process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL,
      hasUserId: !!userId,
      hasBaseUrl: !!process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL,
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
      platform: process.platform
    });

    if (!userId) {
      throw new Error('Spotify user ID is not configured');
    }

    if (!process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL) {
      throw new Error('Spotify base URL is not configured');
    }

    log.info('Making API request to fetch playlists');
    const playlists = await sendApiRequest<{ items: SpotifyPlaylistItem[] }>({
      path: "me/playlists",
    });

    log.info('Playlists fetched', { 
      totalPlaylists: playlists.items.length,
      playlistNames: playlists.items.map(p => p.name),
      playlists: playlists.items.map(p => ({ id: p.id, name: p.name }))
    });

    const todayPlaylist = playlists.items.find(
      (playlist) => playlist.name === name
    );

    if (!todayPlaylist) {
      log.info(`No playlist found for today: ${name}`, {
        availablePlaylists: playlists.items.map(p => p.name),
        expectedName: name
      });
      return null;
    }

    log.info('Found today\'s playlist', { 
      playlistId: todayPlaylist.id,
      playlistName: todayPlaylist.name
    });

    log.info('Fetching playlist details', { playlistId: todayPlaylist.id });
    const playlist = await sendApiRequest<SpotifyPlaylistItem>({
      path: `users/${userId}/playlists/${todayPlaylist.id}`,
    });

    return playlist;
  } catch (error) {
    const apiError = error as SpotifyApiError;
    const errorDetails = {
      error: apiError,
      statusCode: apiError.response?.data?.error?.message,
      userId: userId,
      response: apiError.response,
      message: apiError.message,
      stack: apiError.stack,
      hasUserId: !!userId,
      hasBaseUrl: !!process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL,
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

    log.error('Error getting today\'s playlist', errorDetails);
    
    if (apiError.response?.data?.error?.message?.includes('401')) {
      throw new ApiError('Spotify authentication failed. Please check your access token.', 401, errorDetails);
    }
    
    throw new ApiError('Failed to get today\'s playlist', 500, errorDetails);
  }
}

async function getCurrentlyPlaying(): Promise<string | null> {
  try {
    const response = await sendApiRequest<SpotifyPlaybackState>({
      path: "me/player/currently-playing",
    });
    return response.item?.id ?? null;
  } catch (error) {
    const apiError = error as SpotifyApiError;
    log.error('Error getting currently playing track', {
      error: apiError,
      statusCode: apiError.response?.data?.error?.message
    });
    
    if (apiError.response?.data?.error?.message?.includes('401')) {
      throw new ApiError('Spotify authentication failed. Please check your access token.', 401, apiError);
    }
    
    return null;
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
    await sendApiRequest({
      path: `playlists/${playlistId}/tracks`,
      method: "POST",
      body: JSON.stringify({
        uris: [trackUri],
      }),
    });
    return true;
  } catch (error) {
    const apiError = error as SpotifyApiError;
    log.error('Error adding track to playlist', {
      error: apiError,
      statusCode: apiError.response?.data?.error?.message,
      playlistId,
      trackUri
    });
    
    if (apiError.response?.data?.error?.message?.includes('401')) {
      throw new ApiError('Spotify authentication failed. Please check your access token.', 401, apiError);
    }
    
    if (apiError.message?.includes(ERROR_MESSAGES.TRACK_EXISTS)) {
      return false;
    }
    throw new Error(apiError.message || ERROR_MESSAGES.GENERIC_ERROR);
  }
}

async function handleTrackSuggestion(existingTrackIds: string[], retryCount: number, playlistId: string): Promise<boolean> {
  const selectedTrack = await findSuggestedTrack(existingTrackIds);
  
  if (!selectedTrack) {
    log.info(`${ERROR_MESSAGES.NO_SUGGESTIONS} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    return false;
  }

  log.info(`Attempting to add suggested track: ${selectedTrack.name}`, {
    attempt: retryCount + 1,
    maxRetries: MAX_RETRIES,
    trackId: selectedTrack.id
  });
  
  return await tryAddTrack(selectedTrack.uri, playlistId);
}

async function addSuggestedTrackToPlaylist(upcomingTracks: TrackItem[], playlistId: string): Promise<{ success: boolean; error?: string }> {
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

    while (!success && retryCount < MAX_RETRIES) {
      success = await handleTrackSuggestion(existingTrackIds, retryCount, playlistId);
      
      if (!success) {
        console.log(`Track already exists or no suitable track found, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        retryCount++;
        await waitForRetry(retryCount);
      }
    }

    if (success) {
      lastAddTime = now;
      return { success: true };
    } else {
      throw new Error(ERROR_MESSAGES.MAX_RETRIES);
    }
  } catch (error) {
    const apiError = error as SpotifyApiError;
    console.error("Error getting/adding suggestion:", {
      error: apiError,
      upcomingTracksLength: upcomingTracks.length,
    });
    return { success: false, error: apiError.message || ERROR_MESSAGES.GENERIC_ERROR };
  }
}

interface ErrorDetails {
  message?: string;
  status?: number;
  statusText?: string;
  error?: {
    message?: string;
  };
  requestUrl?: string;
  requestMethod?: string;
  responseHeaders?: Record<string, string>;
}

export async function GET() {
  try {
    log.info('Refresh site request received');
    
    // Check rate limiting
    if (isRateLimited()) {
      throw new ApiError('Rate limit exceeded', 429);
    }
    
    // Check if we have a valid Spotify user ID
    if (!userId) {
      log.error('Spotify user ID not configured');
      throw new ApiError('Spotify user ID not configured', 500);
    }
    
    // Get today's playlist
    log.info('Fetching today\'s playlist');
    const playlist = await getTodayPlaylist();
    if (!playlist) {
      log.error('No playlist found for today');
      throw new ApiError('No playlist found for today', 404);
    }

    // Get currently playing track
    log.info('Fetching currently playing track');
    const currentTrackId = await getCurrentlyPlaying();
    
    // Get upcoming tracks
    log.info('Filtering upcoming tracks');
    const upcomingTracks = filterUpcomingTracks(playlist.tracks.items, currentTrackId);
    
    log.info('Adding suggested track to playlist');
    const result = await addSuggestedTrackToPlaylist(upcomingTracks, playlist.id);
    
    if (!result.success) {
      log.error('Failed to add suggested track', { error: result.error });
      throw new ApiError(result.error || 'Failed to add suggested track', 500);
    }
    
    log.info('Successfully added suggested track');
    return NextResponse.json({ 
      success: true, 
      message: 'Successfully added suggested track',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError('Failed to refresh site', 500, error);
    const errorDetails = apiError.details as ErrorDetails;
    
    log.error('Error in refresh site endpoint', {
      error: apiError,
      stack: apiError.stack,
      details: apiError.details
    });
    
    // Extract the most relevant error information
    const errorMessage = errorDetails?.message || 
                        errorDetails?.error?.message || 
                        apiError.message;
    
    const statusCode = errorDetails?.status || 
                      (errorMessage?.includes('401') ? 401 : 
                       errorMessage?.includes('404') ? 404 : 
                       errorMessage?.includes('429') ? 429 : 500);
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        details: {
          statusCode,
          statusText: errorDetails?.statusText,
          errorMessage: errorDetails?.error?.message,
          environment: process.env.NODE_ENV,
          hasUserId: !!userId,
          hasBaseUrl: !!process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL,
          requestUrl: errorDetails?.requestUrl,
          requestMethod: errorDetails?.requestMethod,
          responseHeaders: errorDetails?.responseHeaders,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      },
      { status: statusCode }
    );
  }
} 