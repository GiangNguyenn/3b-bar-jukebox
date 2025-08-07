import type { Metadata } from 'next'
import { Belgrano } from 'next/font/google'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/react'
import './globals.css'
import Header from '@/components/Header'
import { ConsoleLogsProvider } from '@/hooks/ConsoleLogsProvider'
import { ToastProvider } from '@/contexts/ToastContext'

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
  metadataBase: new URL('https://3bsaigonjukebox.com'),
  title: '3B Jukebox',
  description: 'The Ultimate Shared Music Experience',
  icons: {
    icon: '/icon.ico',
    shortcut: '/icon.ico',
    apple: '/icon.ico'
  },
  keywords:
    'jukebox, live music, craft beer, Saigon, Ho Chi Minh City, bar, music venue',
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
    url: 'https://3bsaigonjukebox.com',
    siteName: '3B Jukebox',
    title: '3B Jukebox',
    description: 'The Ultimate Shared Music Experience',
    images: [
      {
        url: '/images/og-image.jpg', // You'll need to add this image
        width: 1200,
        height: 630,
        alt: '3B Jukebox - The Ultimate Shared Music Experience'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: '3B Jukebox',
    description: 'The Ultimate Shared Music Experience',
    images: ['/images/og-image.jpg'], // Same image as OpenGraph
    creator: '@3bsaigon' // Add your Twitter handle if you have one
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
    google: 'your-google-site-verification' // Add your Google Search Console verification code
  },
  alternates: {
    canonical: 'https://3bsaigonjukebox.com' // Add your actual domain
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
