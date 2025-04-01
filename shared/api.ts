interface ApiProps {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: any;
  extraHeaders?: Record<string, string>;
  config?: Omit<RequestInit, 'method' | 'headers' | 'body'>;
}

interface SpotifyErrorResponse {
  error: {
    status: number;
    message: string;
    reason?: string;
  };
}

const SPOTIFY_API_URL = process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL || "https://api.spotify.com/v1";

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
    baseUrl: SPOTIFY_API_URL,
    hasBody: !!body,
    hasExtraHeaders: !!extraHeaders,
    body: body ? JSON.stringify(body) : undefined
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

  try {
    const url = `${SPOTIFY_API_URL}/${path}`;
    console.log("Making request to:", url);

    const response = await fetch(url, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) }),
      ...config,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("API request failed:", {
        status: response.status,
        statusText: response.statusText,
        data: errorData,
        url,
        method,
        requestBody: body ? JSON.stringify(body) : undefined
      });

      // Handle Spotify API error format
      if (errorData.error) {
        const spotifyError = errorData as SpotifyErrorResponse;
        const errorMessage = spotifyError.error.message || 
                           spotifyError.error.reason || 
                           `Spotify API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Handle generic error format
      throw new Error(errorData.message || `API request failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log("API response received:", {
      status: response.status,
      hasData: !!data,
      data: data
    });

    return data;
  } catch (error) {
    console.error("API request failed:", {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      url: `${SPOTIFY_API_URL}/${path}`,
      method,
      requestBody: body ? JSON.stringify(body) : undefined
    });
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
  
  // Get the base URL for the token endpoint
  let baseUrl = '';
  
  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    // In browser, use the current origin
    baseUrl = window.location.origin;
  } else {
    // In server-side code, use environment variable or default
    baseUrl = process.env.VERCEL_URL ? 
      `https://${process.env.VERCEL_URL}` : 
      process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  }
  
  console.log("Using base URL:", baseUrl);
  
  try {
    const response = await fetch(`${baseUrl}/api/token`, {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Failed to fetch token:", {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
        url: `${baseUrl}/api/token`,
        environment: process.env.NODE_ENV,
        vercelUrl: process.env.VERCEL_URL,
        baseUrl
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
  } catch (error) {
    console.error("Error fetching token:", {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      baseUrl,
      environment: process.env.NODE_ENV,
      vercelUrl: process.env.VERCEL_URL
    });
    throw error;
  }
}
