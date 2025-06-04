/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import NextAuth from 'next-auth'
import SpotifyProvider from 'next-auth/providers/spotify'
import type { NextAuthOptions } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import type { Session } from 'next-auth'
import type { Account, User } from 'next-auth'

// Extend the built-in session types
declare module 'next-auth' {
  interface Session {
    accessToken?: string
    error?: string
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    refreshToken?: string
    accessTokenExpires?: number
    error?: string
    user?: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}

interface SpotifyTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  error?: string
}

function isSpotifyTokenResponse(json: unknown): json is SpotifyTokenResponse {
  return (
    typeof json === 'object' &&
    json !== null &&
    typeof (json as Record<string, unknown>).access_token === 'string' &&
    typeof (json as Record<string, unknown>).expires_in === 'number'
  )
}

const authOptions: NextAuthOptions = {
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'user-read-email',
            'playlist-modify-public',
            'playlist-modify-private',
            'playlist-read-private',
            'user-read-playback-state',
            'user-modify-playback-state'
          ].join(' ')
        }
      }
    })
  ],
  callbacks: {
    async jwt({
      token,
      account,
      user
    }: {
      token: JWT
      account: Account | null
      user: User | null
    }): Promise<JWT> {
      // Initial sign in
      if (account && user) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at
            ? account.expires_at * 1000
            : undefined, // Convert to milliseconds
          user: {
            id: account.providerAccountId,
            name: user.name,
            email: user.email,
            image: user.image
          }
        }
      }

      // Return previous token if the access token has not expired yet
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
        return token
      }

      // Access token has expired, try to update it
      return refreshAccessToken(token)
    },
    session({ session, token }: { session: Session; token: JWT }): Session {
      if (token.user) {
        session.user = token.user
      }

      if (token.accessToken) {
        session.accessToken = token.accessToken
      }

      if (token.error) {
        session.error = token.error
      }

      return session
    }
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error'
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60 // 24 hours
  },
  jwt: {
    maxAge: 30 * 24 * 60 * 60 // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development'
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) {
      throw new Error('No refresh token available')
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken
      })
    })

    const json: unknown = await response.json()
    if (isSpotifyTokenResponse(json)) {
      const refreshedTokens = json
      if (!response.ok) {
        throw new Error(refreshedTokens.error ?? 'Failed to refresh token')
      }
      return {
        ...token,
        accessToken: refreshedTokens.access_token,
        accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
        refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
        error: undefined
      }
    } else {
      throw new Error('Invalid response from Spotify token endpoint')
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error refreshing access token:', error.message)
    } else {
      console.error('Error refreshing access token:', error)
    }
    return {
      ...token,
      accessToken: undefined,
      refreshToken: undefined,
      accessTokenExpires: undefined,
      error: 'RefreshAccessTokenError',
      user: undefined
    }
  }
}

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
