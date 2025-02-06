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

export async function getSpotifyToken() {
  const response = await fetch("/api/token");
  if (!response.ok) {
    throw new Error("Failed to fetch Spotify token");
  }
  const data = await response.json();
  return data.accessToken;
}
