import type { Metadata } from 'next'
import { Belgrano } from 'next/font/google'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/react'
import './globals.css'
import Header from '@/components/Header'
import { ConsoleLogsProvider } from '@/hooks/ConsoleLogsProvider'
import { ToastProvider } from '@/contexts/ToastContext'
import StructuredData from './components/StructuredData'

// const geistSans = localFont({
//   src: "./fonts/GeistVF.woff",
//   variable: "--font-geist-sans",
//   weight: "100 900",
// });
// const geistMono = localFont({
//   src: "./fonts/GeistMonoVF.woff",
//   variable: "--font-geist-mono",
//   weight: "100 900",
// });

const belgrano = Belgrano({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-belgrano'
})

export const metadata: Metadata = {
  metadataBase: new URL('https://jukebox.beer'),
  title:
    'Jukebox for Spotify - Shared Playlist & Collaborative Music Experience',
  description:
    'Create the ultimate shared music experience with our Spotify jukebox. Perfect for parties, friends, and collaborative playlists. Let everyone contribute to the perfect playlist with our intelligent jukebox system.',
  keywords: [
    'jukebox for spotify',
    'spotify shared playlist',
    'collaborative music',
    'party jukebox',
    'shared music experience',
    'spotify jukebox',
    'group playlist',
    'music for parties',
    'collaborative playlist',
    'spotify integration',
    'jukebox app',
    'music sharing',
    'live music',
    'craft beer',
    'Saigon',
    'Ho Chi Minh City',
    'bar',
    'music venue'
  ].join(', '),
  authors: [{ name: '3B Saigon' }],
  creator: '3B Saigon',
  publisher: '3B Saigon',
  formatDetection: {
    email: false,
    address: false,
    telephone: false
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://jukebox.beer',
    siteName: '3B Jukebox - Spotify Shared Playlist',
    title:
      'Jukebox for Spotify - Shared Playlist & Collaborative Music Experience',
    description:
      'Create the ultimate shared music experience with our Spotify jukebox. Perfect for parties, friends, and collaborative playlists. Let everyone contribute to the perfect playlist.',
    images: [
      {
        url: '/logo.png',
        width: 1200,
        height: 630,
        alt: '3B Jukebox - Spotify Shared Playlist & Collaborative Music Experience'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title:
      'Jukebox for Spotify - Shared Playlist & Collaborative Music Experience',
    description:
      'Create the ultimate shared music experience with our Spotify jukebox. Perfect for parties, friends, and collaborative playlists.',
    images: ['/logo.png'],
    creator: '@3bsaigon'
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1
    }
  },
  verification: {
    google: 'cVa_mhwMZQx1VRfJrCcWUQk3lwyiUtNBUDxniMTVC7E'
  },
  alternates: {
    canonical: 'https://jukebox.beer'
  },
  other: {
    'application-name': '3B Jukebox',
    'apple-mobile-web-app-title': '3B Jukebox',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'default',
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#000000',
    'msapplication-config': '/browserconfig.xml',
    manifest: '/manifest.json'
  }
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>): JSX.Element {
  return (
    <html lang='en' className=''>
      <head>
        <Script src='/spotify-init.js' strategy='afterInteractive' />
        <StructuredData />
        <meta
          name='google-site-verification'
          content='cVa_mhwMZQx1VRfJrCcWUQk3lwyiUtNBUDxniMTVC7E'
        />
      </head>
      <body className={`${belgrano.variable} min-h-screen antialiased`}>
        <ToastProvider>
          <ConsoleLogsProvider>
            <Header />
            {children}
          </ConsoleLogsProvider>
        </ToastProvider>
        <Analytics />
      </body>
    </html>
  )
}
