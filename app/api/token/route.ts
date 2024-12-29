import axios from "axios";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

/**
 * Fetch a new access token using the stored refresh token
 */
async function getRefreshToken() {
  console.log("Refreshing Spotify access token...");

  if (!refreshToken) {
    throw new Error("No refresh token available");
  }

  // Prepare request payload
  const payload = {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  };

  try {
    const response = await fetch(SPOTIFY_TOKEN_URL, payload);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `Failed to refresh token: ${data.error_description || "Unknown error"}`
      );
    }

    console.log("Access token refreshed successfully.");
    console.log("New access token:", data.access_token);
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing Spotify token:", error.message);
    throw error;
  }
}

/**
 * Handler to ensure a valid access token is available
 */
export async function GET() {
  try {
    const token = await getRefreshToken();
    return new Response(JSON.stringify({ accessToken: token }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error refreshing access token:", error);
    return new Response(
      JSON.stringify({ error: "Failed to refresh Spotify access token" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
