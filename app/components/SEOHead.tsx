import type { Metadata } from 'next'

interface SEOHeadProps {
  title?: string
  description?: string
  keywords?: string[]
  image?: string
  url?: string
  type?: 'website' | 'article'
}

export function generateMetadata({
  title = 'Jukebox for Spotify - Shared Playlist & Collaborative Music Experience',
  description = 'Create the ultimate shared music experience with our Spotify jukebox. Perfect for parties, friends, and collaborative playlists.',
  keywords = [
    'jukebox for spotify',
    'spotify shared playlist',
    'collaborative music',
    'party jukebox',
    'shared music experience'
  ],
  image = '/logo.png',
  url = 'https://jukebox.beer',
  type = 'website'
}: SEOHeadProps = {}): Metadata {
  return {
    title,
    description,
    keywords: keywords.join(', '),
    openGraph: {
      title,
      description,
      url,
      siteName: '3B Jukebox - Spotify Shared Playlist',
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title
        }
      ],
      type
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image]
    },
    alternates: {
      canonical: url
    }
  }
}
