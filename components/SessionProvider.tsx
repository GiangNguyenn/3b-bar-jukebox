'use client'

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react'

export function SessionProvider({
  children
}: {
  children: React.ReactNode
}): JSX.Element {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>
}
