import { NextResponse } from "next/server";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

export async function GET() {
  try {
    console.log('\n=== Token Refresh Process ===');
    console.log('Environment check:');
    console.log('- Client ID:', CLIENT_ID ? 'Set' : 'Not set');
    console.log('- Client Secret:', CLIENT_SECRET ? 'Set' : 'Not set');
    console.log('- Refresh Token:', refreshToken ? 'Set' : 'Not set');
    console.log('- Environment:', process.env.NODE_ENV);
    console.log('- Vercel URL:', process.env.VERCEL_URL);
    console.log('===========================\n');

    if (!refreshToken) {
      console.error('\n[ERROR] No refresh token available');
      return NextResponse.json(
        { error: "No refresh token available" },
        { status: 500 }
      );
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('\n[ERROR] Missing Spotify credentials');
      return NextResponse.json(
        { error: "Missing Spotify credentials" },
        { status: 500 }
      );
    }

    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    console.log('\n[INFO] Making request to Spotify token endpoint...');
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('\n[ERROR] Failed to refresh token:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      return NextResponse.json(
        { error: errorData.error_description || "Failed to refresh token" },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('\n[INFO] Token refresh successful');
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('\n[ERROR] Unexpected error in token refresh:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
