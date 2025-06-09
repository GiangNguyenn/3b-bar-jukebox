import { DefaultSession, Account as NextAuthAccount } from 'next-auth'
import { JWT as NextAuthJWT } from 'next-auth/jwt'

declare module 'next-auth' {
  interface Session extends DefaultSession {
    accessToken?: string
    error?: string
    provider_token?: string
    provider_refresh_token?: string
    provider_token_expires_at?: number
  }
  interface Account extends NextAuthAccount {
    expires_at: number
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends NextAuthJWT {
    accessToken?: string
    refreshToken?: string
    accessTokenExpires?: number
    error?: string
    user?: Session['user']
    provider_token?: string
    provider_refresh_token?: string
    provider_token_expires_at?: number
  }
}
