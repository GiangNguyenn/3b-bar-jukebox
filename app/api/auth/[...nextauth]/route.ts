/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import NextAuth from 'next-auth'
import SpotifyProvider from 'next-auth/providers/spotify'
import type { NextAuthOptions } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import type { Session } from 'next-auth'
import type { Account, User } from 'next-auth'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

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

export const authOptions: NextAuthOptions = {
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          scope: [
            'user-read-email',
            'playlist-modify-public',
            'playlist-modify-private',
            'playlist-read-private',
            'user-read-playback-state',
            'user-modify-playback-state',
            'user-read-private',
            'playlist-read-collaborative',
            'user-library-read',
            'user-library-modify'
          ].join(' ')
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account && user) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0,
          user
        }
      }

      // Return previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires ?? 0)) {
        return token
      }

      // Access token has expired, try to update it
      return refreshAccessToken(token)
    },
    async session({ session, token }) {
      if (token) {
        session.user = token.user ?? session.user
        session.accessToken = token.accessToken
        session.error = token.error
      }

      return session
    },
    async signIn({ user, account }) {
      if (!account?.provider || account.provider !== 'spotify') {
        return false
      }

      try {
        const supabase = createRouteHandlerClient({ cookies })

        // Create or update user in Supabase
        const { data: { user: supabaseUser }, error: userError } = await supabase.auth.signInWithOAuth({
          provider: 'spotify',
          options: {
            redirectTo: `${process.env.NEXTAUTH_URL}/api/auth/callback/supabase`,
            scopes: [
              'user-read-email',
              'playlist-modify-public',
              'playlist-modify-private',
              'playlist-read-private',
              'user-read-playback-state',
              'user-modify-playback-state',
              'user-read-private',
              'playlist-read-collaborative',
              'user-library-read',
              'user-library-modify'
            ].join(' ')
          }
        })

        if (userError) {
          console.error('Error signing in with Supabase:', userError)
          return false
        }

        if (!supabaseUser?.id) {
          console.error('No Supabase user ID returned')
          return false
        }

        // Create profile if it doesn't exist
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', supabaseUser.id)
          .single()

        if (profileError && profileError.code !== 'PGRST116') {
          console.error('Error checking profile:', profileError)
          return false
        }

        if (!profile) {
          // Create new profile
          const { error: insertError } = await supabase
            .from('profiles')
            .insert({
              id: supabaseUser.id,
              display_name: user.name,
              spotify_user_id: account.providerAccountId
            })

          if (insertError) {
            console.error('Error creating profile:', insertError)
            return false
          }
        }

        return true
      } catch (error) {
        console.error('Error in signIn callback:', error)
        return false
      }
    },
    async redirect({ url, baseUrl }) {
      // After sign in, redirect to the user's playlist page
      if (url.startsWith(baseUrl)) {
        const supabase = createRouteHandlerClient({ cookies })
        const { data: { user } } = await supabase.auth.getUser()
        
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', user.id)
            .single()

          if (profile?.display_name) {
            return `${baseUrl}/${profile.display_name}/playlist`
          }
        }
      }
      return url
    }
  },
  pages: {
    signIn: '/',
    error: '/'
  },
  debug: process.env.NODE_ENV === 'development'
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken ?? '',
        client_id: process.env.SPOTIFY_CLIENT_ID ?? '',
        client_secret: process.env.SPOTIFY_CLIENT_SECRET ?? ''
      })
    })

    const tokens: SpotifyTokenResponse = await response.json()

    if (!response.ok) {
      throw tokens
    }

    return {
      ...token,
      accessToken: tokens.access_token,
      accessTokenExpires: Date.now() + tokens.expires_in * 1000,
      // Fall back to old refresh token, but note that
      // many providers give a new refresh token when you refresh the access token
      refreshToken: tokens.refresh_token ?? token.refreshToken
    }
  } catch (error) {
    console.error('Error refreshing access token:', error)
    return {
      ...token,
      error: 'RefreshAccessTokenError'
    }
  }
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
