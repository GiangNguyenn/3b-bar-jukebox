'use client'

import { SessionProvider } from '@/components/SessionProvider'

export default function AuthLayout({
  children
}: {
  children: React.ReactNode
}): JSX.Element {
  return <SessionProvider>{children}</SessionProvider>
}
