export default function StructuredData(): JSX.Element {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '3B Jukebox - Spotify Shared Playlist',
    description:
      'Create the ultimate shared music experience with our Spotify jukebox. Perfect for parties, friends, and collaborative playlists.',
    url: 'https://jukebox.beer',
    applicationCategory: 'MusicApplication',
    operatingSystem: 'Web Browser',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Free tier available with premium upgrade options'
    },
    featureList: [
      'Spotify Integration',
      'Collaborative Playlists',
      'Shared Music Experience',
      'Party Jukebox',
      'Group Playlist Management'
    ],
    author: {
      '@type': 'Organization',
      name: '3B Saigon',
      url: 'https://jukebox.beer'
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '150'
    }
  }

  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData)
      }}
    />
  )
}
