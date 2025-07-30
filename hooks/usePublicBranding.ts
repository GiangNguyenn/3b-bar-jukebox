import { useState, useEffect } from 'react'
import type { Database } from '@/types/supabase'

type BrandingSettings = Database['public']['Tables']['branding_settings']['Row']

export function usePublicBranding(username: string) {
  const [settings, setSettings] = useState<BrandingSettings | null>(null)
  const [loading, setLoading] = useState(true)

  // Update favicon when settings change
  useEffect(() => {
    if (settings?.favicon_url) {
      // Remove existing favicon links
      const existingLinks = document.querySelectorAll('link[rel*="icon"]')
      existingLinks.forEach((link) => link.remove())

      // Create new favicon link
      const link = document.createElement('link')
      link.rel = 'icon'
      link.type = 'image/x-icon'
      link.href = settings.favicon_url
      document.head.appendChild(link)

      // Also set shortcut icon for older browsers
      const shortcutLink = document.createElement('link')
      shortcutLink.rel = 'shortcut icon'
      shortcutLink.type = 'image/x-icon'
      shortcutLink.href = settings.favicon_url
      document.head.appendChild(shortcutLink)

      // Set apple touch icon if it's a PNG/SVG
      if (settings.favicon_url.match(/\.(png|svg)$/i)) {
        const appleLink = document.createElement('link')
        appleLink.rel = 'apple-touch-icon'
        appleLink.href = settings.favicon_url
        document.head.appendChild(appleLink)
      }
    } else {
      // Reset to default favicon if no custom favicon is set
      const existingLinks = document.querySelectorAll('link[rel*="icon"]')
      existingLinks.forEach((link) => link.remove())

      // Add default favicon
      const link = document.createElement('link')
      link.rel = 'icon'
      link.type = 'image/x-icon'
      link.href = '/icon.ico'
      document.head.appendChild(link)

      const shortcutLink = document.createElement('link')
      shortcutLink.rel = 'shortcut icon'
      shortcutLink.type = 'image/x-icon'
      shortcutLink.href = '/icon.ico'
      document.head.appendChild(shortcutLink)
    }
  }, [settings?.favicon_url])

  useEffect(() => {
    const fetchBranding = async () => {
      try {
        // Don't fetch if username is empty or undefined
        if (!username || username.trim() === '') {
          setLoading(false)
          return
        }

        console.log('Fetching branding settings for username:', username)
        const response = await fetch(`/api/branding/public/${username}`)

        if (!response.ok) {
          if (response.status === 404) {
            // Profile not found, but this is not an error for branding
            setLoading(false)
            return
          }
          throw new Error(
            `Failed to fetch branding settings: ${response.status}`
          )
        }

        const brandingSettings = await response.json()
        console.log('Branding settings loaded:', brandingSettings)
        setSettings(brandingSettings)
      } catch (error) {
        console.error('Error fetching branding settings:', error)
      } finally {
        setLoading(false)
      }
    }

    void fetchBranding()
  }, [username])

  return { settings, loading }
}
