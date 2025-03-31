import axios, { AxiosRequestConfig } from "axios";

interface ApiProps {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: any;
  extraHeaders?: Record<string, string>;
  config?: AxiosRequestConfig;
}

const baseUrl = process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL ?? "";

export const sendApiRequest = async <T>({
  path,
  method = "GET",
  body,
  extraHeaders,
  config = {},
}: ApiProps): Promise<T> => {
  console.log("Making API request:", {
    path,
    method,
    baseUrl,
    hasBody: !!body,
    hasExtraHeaders: !!extraHeaders
  });

  const authToken = await getSpotifyToken();
  if (!authToken) {
    throw new Error("Failed to get Spotify token");
  }
  console.log("Got auth token:", "Present");

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
    ...(extraHeaders && { ...extraHeaders }),
  };

  console.log("Request headers:", {
    hasContentType: !!headers["Content-Type"],
    hasAuthorization: !!headers["Authorization"],
    extraHeaders: Object.keys(extraHeaders || {})
  });

  try {
    const url = `${baseUrl}/${path}`;
    console.log("Making request to:", url);

    const response = await axios(url, {
      method,
      headers,
      ...(body && { data: body }),
      ...config,
    });

    console.log("API response received:", {
      status: response.status,
      hasData: !!response.data
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("API request failed:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: `${baseUrl}/${path}`,
        method,
        hasAuthToken: !!authToken
      });
    } else {
      console.error("API request failed:", {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        url: `${baseUrl}/${path}`,
        method,
        hasAuthToken: !!authToken
      });
    }
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

  console.log("Fetching new token...");
  
  // Get the base URL from environment or construct it
  let baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    // In production, use the host from the request
    if (process.env.NODE_ENV === 'production') {
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else {
      // In development, use localhost
      baseUrl = 'http://localhost:3000';
    }
  }
  
  console.log("Using base URL:", baseUrl);
  const response = await fetch(`${baseUrl}/api/token`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error("Failed to fetch token:", {
      status: response.status,
      statusText: response.statusText,
      error: errorData,
      url: `${baseUrl}/api/token`,
      environment: process.env.NODE_ENV
    });
    throw new Error(errorData.error || "Failed to fetch Spotify token");
  }

  const data = await response.json();
  if (!data.access_token) {
    console.error("Invalid token response:", data);
    throw new Error("Invalid token response");
  }

  console.log("New token fetched successfully");

  const newToken = data.access_token;
  const newExpiry = now + data.expires_in * 1000;

  tokenCache.token = newToken;
  tokenCache.expiry = newExpiry;

  return newToken;
}
