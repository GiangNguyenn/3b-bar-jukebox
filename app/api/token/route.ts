const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

async function getRefreshToken() {
  console.log("Refreshing Spotify access token...");

  if (!refreshToken) {
    throw new Error("No refresh token available");
  }

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
    cache: "no-store",
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
    return { accessToken: data.access_token, expires_in: data.expires_in };
  } catch (error) {
    console.error("Error refreshing Spotify token:", error.message);
    throw error;
  }
}

export async function GET() {
  try {
    const { accessToken, expires_in } = await getRefreshToken();
    return new Response(JSON.stringify({ accessToken, expires_in }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error refreshing access token:", error);
  }
}
