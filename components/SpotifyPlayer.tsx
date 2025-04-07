'use client'

import { useEffect, useState } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

declare global {
  interface Window {
    Spotify: any
    onSpotifyWebPlaybackSDKReady: () => void
    refreshSpotifyPlayer?: () => Promise<void>
  }
}

export default function SpotifyPlayer() {
  const [player, setPlayer] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const setDeviceId = useSpotifyPlayer((state) => state.setDeviceId)
  const setIsReady = useSpotifyPlayer((state) => state.setIsReady)
  const setPlaybackState = useSpotifyPlayer((state) => state.setPlaybackState)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)

  // Function to refresh the player's state
  const refreshPlayerState = async () => {
    if (!deviceId) return;
    
    try {
      console.log('Refreshing player state...');
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET',
      });
      console.log('Refreshed player state:', state);
      setPlaybackState(state);
    } catch (error) {
      console.error('Error refreshing player state:', error);
    }
  };

  useEffect(() => {
    let script: HTMLScriptElement | null = null
    let isMounted = true

    const initializePlayer = async () => {
      try {
        console.log('Initializing Spotify player...')
        
        // Fetch token from our API
        const response = await fetch('/api/token')
        if (!response.ok) {
          throw new Error('Failed to get Spotify token')
        }
        const { access_token } = await response.json()
        console.log('Successfully retrieved Spotify token')

        if (!window.Spotify) {
          throw new Error('Spotify SDK not loaded')
        }

        const player = new window.Spotify.Player({
          name: 'JM Bar Jukebox',
          getOAuthToken: (cb: (token: string) => void) => {
            cb(access_token)
          },
          volume: 0.5
        })

        console.log('Created Spotify player instance')

        // Add listeners
        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          if (!isMounted) return
          console.log('Player is ready with Device ID:', device_id)
          setDeviceId(device_id)
          setIsReady(true)
          setError(null)
          // Initial state refresh
          refreshPlayerState();
        })

        player.addListener('not_ready', ({ device_id }: { device_id: string }) => {
          if (!isMounted) return
          console.log('Player is not ready, Device ID:', device_id)
          setDeviceId(null)
          setIsReady(false)
        })

        player.addListener('player_state_changed', (state: any) => {
          if (!isMounted) return
          console.log('Player state changed:', state)
          setPlaybackState(state)
        })

        player.addListener('initialization_error', ({ message }: { message: string }) => {
          if (!isMounted) return
          console.error('Player initialization error:', message)
          setError(`Failed to initialize: ${message}`)
          setIsReady(false)
        })

        player.addListener('authentication_error', ({ message }: { message: string }) => {
          if (!isMounted) return
          console.error('Player authentication error:', message)
          setError(`Failed to authenticate: ${message}`)
          setIsReady(false)
        })

        player.addListener('account_error', ({ message }: { message: string }) => {
          if (!isMounted) return
          console.error('Player account error:', message)
          setError(`Failed to validate Spotify account: ${message}`)
          setIsReady(false)
        })

        // Connect to the player
        console.log('Attempting to connect player...')
        const connected = await player.connect()
        if (!connected) {
          throw new Error('Failed to connect to Spotify player')
        }
        console.log('Successfully connected to Spotify player')

        if (isMounted) {
          setPlayer(player)
        }
      } catch (error) {
        if (!isMounted) return
        console.error('Error in Spotify player initialization:', error)
        setError(error instanceof Error ? error.message : 'Failed to initialize Spotify player')
        setIsReady(false)
      }
    }

    // Define the callback before loading the SDK
    window.onSpotifyWebPlaybackSDKReady = initializePlayer

    // Load the Spotify SDK
    script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true

    script.onerror = () => {
      if (!isMounted) return
      console.error('Failed to load Spotify Web Playback SDK')
      setError('Failed to load Spotify Web Playback SDK')
      setIsReady(false)
    }

    console.log('Loading Spotify Web Playback SDK...')
    document.body.appendChild(script)

    return () => {
      console.log('Cleaning up Spotify player...')
      isMounted = false
      if (player) {
        player.disconnect()
      }
      if (script && document.body.contains(script)) {
        document.body.removeChild(script)
      }
      // Clean up the callback
      window.onSpotifyWebPlaybackSDKReady = () => {}
    }
  }, [setDeviceId, setIsReady, setPlaybackState, deviceId])

  // Export the refresh function to be used by other components
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).refreshSpotifyPlayer = refreshPlayerState;
    }
  }, [deviceId]);

  if (error) {
    return (
      <div className="p-4 bg-red-100 text-red-700 rounded">
        {error}
      </div>
    )
  }

  return null
} 