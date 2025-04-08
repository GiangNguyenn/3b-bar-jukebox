import { NextResponse } from "next/server";
import { handleOperationError, AppError } from "@/shared/utils/errorHandling";
import { ERROR_MESSAGES } from "@/shared/constants/errors";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

export async function GET() {
  try {
    if (!refreshToken) {
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, "TokenRefresh");
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, "TokenRefresh");
    }

    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

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
        error: errorData,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      throw new AppError(
        ERROR_MESSAGES.UNAUTHORIZED,
        {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        },
        "TokenRefresh"
      );
    }

    const data = await response.json();
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('\n[ERROR] Unexpected error in token refresh:', error);
    const appError = error instanceof AppError ? error : new AppError(
      ERROR_MESSAGES.GENERIC_ERROR,
      error,
      "TokenRefresh"
    );
    
    return NextResponse.json(
      { 
        error: appError.message,
        details: appError.originalError
      },
      { status: 500 }
    );
  }
}
