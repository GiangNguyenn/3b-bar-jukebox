import axios, { AxiosRequestConfig } from "axios";

interface ApiProps {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: any;
  extraHeaders?: Record<string, string>;
  config?: AxiosRequestConfig;
}

const baseUrl = process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL ?? "";
const TOKEN_KEY = "spotify_token";
const TOKEN_EXPIRY_KEY = "spotify_token_expiry";

export const sendApiRequest = async <T>({
  path,
  method = "GET",
  body,
  extraHeaders,
  config = {},
}: ApiProps): Promise<T> => {
  const authToken = await getSpotifyToken();
  const headers = {
    "Content-Type": "application/json",
    ...(authToken && { Authorization: `Bearer ${authToken}` }),
    ...(extraHeaders && { ...extraHeaders }),
  };

  try {
    const response = await axios(`${baseUrl}/${path}`, {
      method,
      headers,
      ...(body && { data: body }),
      ...config,
    });

    return response.data;
  } catch (error) {
    throw error;
  }
};

const tokenCache: { token: string | null; expiry: number } = {
  token: null,
  expiry: 0,
};

async function getSpotifyToken() {
  const now = Date.now();

  if (tokenCache.token && now < tokenCache.expiry) {
    console.log("Using cached Spotify token from memory");
    return tokenCache.token;
  }

  const cachedToken = localStorage.getItem("spotify_token");
  const tokenExpiry = localStorage.getItem("spotify_token_expiry");

  if (cachedToken && tokenExpiry && now < parseInt(tokenExpiry, 10)) {

    tokenCache.token = cachedToken;
    tokenCache.expiry = parseInt(tokenExpiry, 10);

    return cachedToken;
  }

  console.log("Fetching new token...");
  const response = await fetch("/api/token");

  if (!response.ok) {
    throw new Error("Failed to fetch Spotify token");
  }

  const data = await response.json();
  console.log("New token fetched:", data);

  const newToken = data.accessToken;
  const newExpiry = now + data.expires_in * 1000;

  tokenCache.token = newToken;
  tokenCache.expiry = newExpiry;
  localStorage.setItem("spotify_token", newToken);
  localStorage.setItem("spotify_token_expiry", newExpiry.toString());

  return newToken;
}
