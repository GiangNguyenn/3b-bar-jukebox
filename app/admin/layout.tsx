import { Metadata } from 'next'
import Script from 'next/script'
import { ConsoleLogsProvider } from '@/hooks/ConsoleLogsProvider'

export const metadata: Metadata = {
  metadataBase: new URL('https://3bsaigonjukebox.com'),
  title: 'Admin Dashboard'
}

export default function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>): JSX.Element {
  return (
    <ConsoleLogsProvider>
      <div className='min-h-screen bg-black'>
        <Script src='/spotify-init.js' strategy='beforeInteractive' />
        <Script
          src='https://sdk.scdn.co/spotify-player.js'
          strategy='beforeInteractive'
        />
        <main className='container mx-auto px-4 py-8'>{children}</main>
      </div>
    </ConsoleLogsProvider>
  )
}
