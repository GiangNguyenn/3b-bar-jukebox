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
  const authToken = await getSpotifyToken();
  if (!authToken) {
    throw new Error("Failed to get Spotify token");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
    ...(extraHeaders && { ...extraHeaders }),
  };

  try {
    const url = `${SPOTIFY_API_URL}/${path}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...config,
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = null;
      }

      const errorMessage = errorData?.error?.message || `HTTP error! status: ${response.status}`;
      console.error("API request failed:", {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
        url,
        method,
        requestBody: body ? JSON.stringify(body) : undefined
      });

      // Handle specific error cases
      if (response.status === 401) {
        throw new Error("Authentication failed. Please try refreshing the page.");
      } else if (response.status === 403) {
        throw new Error("You don't have permission to perform this action.");
      } else if (response.status === 404) {
        throw new Error("The requested resource was not found.");
      } else if (response.status === 429) {
        throw new Error("Too many requests. Please try again later.");
      } else if (response.status >= 500) {
        throw new Error("Spotify service is currently unavailable. Please try again later.");
      }

      throw new Error(errorMessage);
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return {} as T;
    }

    // Only try to parse JSON if we have content
    if (response.headers.get('content-length') === '0') {
      return {} as T;
    }

    try {
      const data = await response.json();
      return data;
    } catch (e) {
      console.error("Failed to parse response as JSON:", e);
      return {} as T;
    }
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

    // Handle network errors
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      throw new Error("Network error. Please check your internet connection and try again.");
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
    return tokenCache.token;
  }
  
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
