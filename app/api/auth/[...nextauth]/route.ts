import NextAuth from 'next-auth'
import SpotifyProvider from 'next-auth/providers/spotify'
import type { NextAuthOptions } from 'next-auth'

const authOptions: NextAuthOptions = {
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization:
        'https://accounts.spotify.com/authorize?scope=user-read-email,playlist-modify-public,playlist-modify-private,playlist-read-private,user-read-playback-state,user-modify-playback-state'
    })
  ]
  // Add callbacks and session config here as needed
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
