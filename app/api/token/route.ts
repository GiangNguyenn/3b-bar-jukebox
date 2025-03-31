import { NextResponse } from "next/server";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

async function getRefreshToken() {
  console.log('\n=== Token Refresh Process ===');
  console.log('Environment check:');
  console.log('- Client ID:', CLIENT_ID ? 'Set' : 'Not set');
  console.log('- Client Secret:', CLIENT_SECRET ? 'Set' : 'Not set');
  console.log('- Refresh Token:', refreshToken ? 'Set' : 'Not set');
  console.log('===========================\n');

  if (!refreshToken) {
    console.error('\n[ERROR] No refresh token available');
    throw new Error("No refresh token available");
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('\n[ERROR] Missing Spotify credentials');
    throw new Error("Missing Spotify credentials");
  }

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const payload = {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store" as RequestCache,
  };

  console.log('\n[INFO] Making request to Spotify token endpoint...');
  try {
    const response = await fetch(SPOTIFY_TOKEN_URL, payload);
    const data = await response.json();

    if (!response.ok) {
      console.error('\n[ERROR] Failed to refresh token:');
      console.error('Status:', response.status);
      console.error('Status Text:', response.statusText);
      console.error('Error:', data.error);
      console.error('Error Description:', data.error_description);
      throw new Error(
        `Failed to refresh token: ${data.error_description || "Unknown error"}`
      );
    }

    console.log('\n[SUCCESS] Access token refreshed successfully');
    return { access_token: data.access_token, expires_in: data.expires_in };
  } catch (error) {
    console.error('\n[ERROR] Error during token refresh:');
    if (error instanceof Error) {
      console.error('Name:', error.name);
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    } else {
      console.error('Unknown error:', error);
    }
    throw error;
  }
}

export async function GET() {
  try {
    const { access_token, expires_in } = await getRefreshToken();
    return NextResponse.json({ access_token, expires_in });
  } catch (error) {
    console.error('\n[ERROR] Token endpoint error:');
    if (error instanceof Error) {
      console.error('Name:', error.name);
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    } else {
      console.error('Unknown error:', error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh token" },
      { status: 500 }
    );
  }
}
