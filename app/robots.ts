import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/', '/[username]/']
    },
    sitemap: 'https://jukebox.beer/sitemap.xml'
  }
}
