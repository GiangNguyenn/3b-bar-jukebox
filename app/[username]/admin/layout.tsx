'use client'

import Script from 'next/script'
import { ConsoleLogsProvider } from '@/hooks/ConsoleLogsProvider'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useEffect } from 'react'

function SpotifyPlayerInitializer(): JSX.Element {
  const setIsReady = useSpotifyPlayer((state) => state.setIsReady)
  const setDeviceId = useSpotifyPlayer((state) => state.setDeviceId)

  useEffect((): (() => void) => {
    let isMounted = true

    const handleSDKReady = async (): Promise<void> => {
      if (!isMounted) return

      try {
        // Get access token
        const response = await fetch('/api/token')
        if (!response.ok) {
          throw new Error('Failed to get access token')
        }
        const { access_token } = await response.json() as { access_token: string }

        // Create player instance
        const player = new window.Spotify.Player({
          name: '3B Saigon Jukebox',
          getOAuthToken: (cb: (token: string) => void): void => {
            cb(access_token)
          },
          volume: 0.5
        })

        // Set up event handlers
        player.addListener('ready', ({ device_id }: { device_id: string }): void => {
          if (!isMounted) return
          console.log('[SpotifyPlayer] Player ready with device ID:', device_id)
          setDeviceId(device_id)
          setIsReady(true)
        })

        player.addListener('not_ready', (): void => {
          if (!isMounted) return
          console.log('[SpotifyPlayer] Player not ready')
          setIsReady(false)
        })

        player.addListener('initialization_error', ({ message }: { message: string }): void => {
          if (!isMounted) return
          console.error('[SpotifyPlayer] Initialization error:', message)
          setIsReady(false)
        })

        player.addListener('authentication_error', ({ message }: { message: string }): void => {
          if (!isMounted) return
          console.error('[SpotifyPlayer] Authentication error:', message)
          setIsReady(false)
        })

        player.addListener('account_error', ({ message }: { message: string }): void => {
          if (!isMounted) return
          console.error('[SpotifyPlayer] Account error:', message)
          setIsReady(false)
        })

        // Connect to Spotify
        const connected = await player.connect()
        if (!connected) {
          throw new Error('Failed to connect to Spotify')
        }

        // Store the player instance
        window.spotifyPlayerInstance = player
      } catch (error) {
        if (!isMounted) return
        console.error('[SpotifyPlayer] Error initializing player:', error)
        setIsReady(false)
      }
    }

    // Check if SDK is already loaded
    if (window.Spotify) {
      void handleSDKReady()
    } else {
      // Listen for SDK ready event
      const handleSDKReadyEvent = (): void => {
        void handleSDKReady()
      }
      window.addEventListener('spotifySDKReady', handleSDKReadyEvent)

      return () => {
        isMounted = false
        window.removeEventListener('spotifySDKReady', handleSDKReadyEvent)
      }
    }

    return () => {
      isMounted = false
    }
  }, [setIsReady, setDeviceId])

  return <></>
}

export default function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>): JSX.Element {
  return (
    <div className='min-h-screen bg-black'>
      <Script src='/spotify-init.js' strategy='beforeInteractive' />
      <Script
        src='https://sdk.scdn.co/spotify-player.js'
        strategy='beforeInteractive'
      />
      <ConsoleLogsProvider>
        <SpotifyPlayerInitializer />
        <main className='container mx-auto px-4 py-8'>{children}</main>
      </ConsoleLogsProvider>
    </div>
  )
} 