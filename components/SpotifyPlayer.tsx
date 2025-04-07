'use client'

import { useEffect, useState, useRef } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

declare global {
  interface Window {
    Spotify: any
    onSpotifyWebPlaybackSDKReady: () => void
    refreshSpotifyPlayer?: () => Promise<void>
    spotifyPlayerInstance?: any
  }
}

// Singleton to track initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
let playerInstance: any = null;

export default function SpotifyPlayer() {
  const [error, setError] = useState<string | null>(null)
  const setDeviceId = useSpotifyPlayer((state) => state.setDeviceId)
  const setIsReady = useSpotifyPlayer((state) => state.setIsReady)
  const setPlaybackState = useSpotifyPlayer((state) => state.setPlaybackState)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isMounted = useRef(true)
  const reconnectAttempts = useRef(0)
  const MAX_RECONNECT_ATTEMPTS = 3
  const initializationCheckInterval = useRef<NodeJS.Timeout | null>(null)

  // Function to check if the player is actually ready
  const checkPlayerReady = async () => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId;
    if (!currentDeviceId) {
      console.log('[SpotifyPlayer] No device ID available for ready check');
      return false;
    }
    
    try {
      console.log('[SpotifyPlayer] Checking player state for device:', currentDeviceId);
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET',
      });
      console.log('[SpotifyPlayer] Player state check result:', state?.device?.id);
      
      // If we don't have a state or device ID, try to transfer playback
      if (!state?.device?.id) {
        console.log('[SpotifyPlayer] No active device found, attempting to transfer playback');
        try {
          await sendApiRequest({
            path: 'me/player',
            method: 'PUT',
            body: {
              device_ids: [currentDeviceId],
              play: false
            },
          });
          // Wait a bit for the transfer to take effect
          await new Promise(resolve => setTimeout(resolve, 2000));
          // Check again
          const newState = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET',
          });
          console.log('[SpotifyPlayer] After transfer, state check result:', newState?.device?.id);
          const isReady = newState?.device?.id === currentDeviceId;
          console.log('[SpotifyPlayer] After transfer, ready state:', isReady);
          if (isReady) {
            setIsReady(true);
          }
          return isReady;
        } catch (error) {
          console.error('[SpotifyPlayer] Error transferring playback:', error);
          return false;
        }
      }
      
      const isReady = state.device.id === currentDeviceId;
      console.log('[SpotifyPlayer] Player ready check result:', isReady);
      
      if (isReady) {
        setIsReady(true);
      }
      return isReady;
    } catch (error) {
      console.error('[SpotifyPlayer] Error checking player state:', error);
      return false;
    }
  };

  // Function to refresh the player's state
  const refreshPlayerState = async () => {
    if (!deviceId) {
      console.log('No device ID available for refresh');
      return;
    }
    
    try {
      console.log('Refreshing player state...');
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET',
      });
      console.log('Refreshed player state:', state);
      
      // Verify the device is still active
      if (state?.device?.id === deviceId) {
        console.log('Device verified active, updating state');
        setPlaybackState(state);
        setIsReady(true);
      } else {
        console.log('Device ID mismatch, attempting to reconnect...');
        reconnectPlayer();
      }
    } catch (error) {
      console.error('Error refreshing player state:', error);
      if ((error as any)?.status === 404) {
        console.log('Device not found, attempting to reconnect...');
        reconnectPlayer();
      }
    }
  };

  const reconnectPlayer = async () => {
    if (!isMounted.current || reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) return;

    console.log(`Attempting to reconnect player (attempt ${reconnectAttempts.current + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
    reconnectAttempts.current++;

    try {
      // Clear the existing player instance
      if (playerInstance) {
        await playerInstance.disconnect();
        playerInstance = null;
      }
      
      // Reset initialization state
      isInitialized = false;
      initializationPromise = null;
      
      // Reinitialize the player
      await initializePlayer();
      reconnectAttempts.current = 0;
    } catch (error) {
      console.error('Failed to reconnect player:', error);
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(reconnectPlayer, 2000);
      } else {
        setError('Failed to reconnect to Spotify player after multiple attempts');
      }
    }
  };

  const initializePlayer = async () => {
    if (isInitialized && playerInstance) {
      console.log('Spotify player already initialized');
      return;
    }

    if (initializationPromise) {
      console.log('Waiting for existing initialization to complete');
      await initializationPromise;
      return;
    }

    initializationPromise = (async () => {
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

        // Check if we already have a player instance
        if (playerInstance) {
          console.log('Using existing Spotify player instance');
          return;
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
        player.addListener('ready', async ({ device_id }: { device_id: string }) => {
          if (!isMounted.current) return
          console.log('[SpotifyPlayer] Player is ready with Device ID:', device_id)
          setDeviceId(device_id)
          
          // Verify the player is actually ready
          const isReady = await checkPlayerReady();
          if (isReady) {
            console.log('[SpotifyPlayer] Player verified ready, updating state');
            setIsReady(true)
            setError(null)
            reconnectAttempts.current = 0;
            // Initial state refresh
            await refreshPlayerState();
            // Double check ready state after refresh
            const finalCheck = await checkPlayerReady();
            if (finalCheck) {
              console.log('[SpotifyPlayer] Final ready check passed, player is fully initialized');
              // Force a state update to ensure UI reflects ready state
              setIsReady(true);
            } else {
              console.log('[SpotifyPlayer] Final ready check failed, attempting reconnect');
              reconnectPlayer();
            }
          } else {
            console.log('[SpotifyPlayer] Player reported ready but verification failed');
            reconnectPlayer();
          }
        })

        player.addListener('not_ready', ({ device_id }: { device_id: string }) => {
          if (!isMounted.current) return
          console.log('[SpotifyPlayer] Player is not ready, Device ID:', device_id)
          setDeviceId(null)
          setIsReady(false)
          reconnectPlayer();
        })

        player.addListener('player_state_changed', (state: any) => {
          if (!isMounted.current) return
          console.log('[SpotifyPlayer] Player state changed:', state?.device?.id)
          setPlaybackState(state)
          // Update ready state based on device ID match
          if (state?.device?.id === deviceId) {
            console.log('[SpotifyPlayer] Device ID match in state change, setting ready');
            setIsReady(true);
          }
        })

        player.addListener('initialization_error', ({ message }: { message: string }) => {
          if (!isMounted.current) return
          console.error('Player initialization error:', message)
          setError(`Failed to initialize: ${message}`)
          setIsReady(false)
        })

        player.addListener('authentication_error', ({ message }: { message: string }) => {
          if (!isMounted.current) return
          console.error('Player authentication error:', message)
          setError(`Failed to authenticate: ${message}`)
          setIsReady(false)
        })

        player.addListener('account_error', ({ message }: { message: string }) => {
          if (!isMounted.current) return
          console.error('Player account error:', message)
          setError(`Failed to validate Spotify account: ${message}`)
          setIsReady(false)
        })

        // Connect to the player
        console.log('[SpotifyPlayer] Attempting to connect player...')
        const connected = await player.connect()
        if (!connected) {
          throw new Error('Failed to connect to Spotify player')
        }
        console.log('[SpotifyPlayer] Successfully connected to Spotify player')

        // Store the player instance globally
        playerInstance = player;
        window.spotifyPlayerInstance = player;
        isInitialized = true;

        // Wait for the player to be ready
        console.log('[SpotifyPlayer] Waiting for player to be ready...');
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Player ready timeout'));
          }, 10000); // 10 second timeout

          const readyHandler = async ({ device_id }: { device_id: string }) => {
            console.log('[SpotifyPlayer] Player ready event received, device_id:', device_id);
            try {
              // First set the device ID and wait for it to be set
              console.log('[SpotifyPlayer] Setting device ID:', device_id);
              setDeviceId(device_id);
              
              // Wait for the state to be updated
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Get the current device ID from the state
              const currentDeviceId = useSpotifyPlayer.getState().deviceId;
              console.log('[SpotifyPlayer] Current device ID from state:', currentDeviceId);
              
              if (!currentDeviceId) {
                console.log('[SpotifyPlayer] Device ID not set in state, retrying...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                const retryDeviceId = useSpotifyPlayer.getState().deviceId;
                if (!retryDeviceId) {
                  throw new Error('Device ID not set in state after retry');
                }
              }
              
              // Try to verify the player is ready up to 3 times
              let isReady = false;
              let attempts = 0;
              const maxAttempts = 3;
              
              while (!isReady && attempts < maxAttempts) {
                console.log(`[SpotifyPlayer] Verification attempt ${attempts + 1}/${maxAttempts}`);
                isReady = await checkPlayerReady();
                if (!isReady) {
                  attempts++;
                  if (attempts < maxAttempts) {
                    console.log('[SpotifyPlayer] Verification failed, waiting before retry...');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Increased wait time
                  }
                }
              }
              
              if (isReady) {
                console.log('[SpotifyPlayer] Player verified ready after', attempts + 1, 'attempts');
                clearTimeout(timeout);
                player.removeListener('ready', readyHandler);
                resolve();
              } else {
                console.log('[SpotifyPlayer] Player verification failed after all attempts');
                reject(new Error('Player verification failed after all attempts'));
              }
            } catch (error) {
              console.error('[SpotifyPlayer] Error in ready handler:', error);
              reject(error);
            }
          };

          player.addListener('ready', readyHandler);
        }).catch(error => {
          console.error('[SpotifyPlayer] Error waiting for player to be ready:', error);
          throw error;
        });

        // Force an immediate state check
        console.log('[SpotifyPlayer] Performing immediate state check');
        try {
          const state = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET',
          });
          console.log('[SpotifyPlayer] Immediate state check result:', state?.device?.id);
          if (state?.device?.id) {
            console.log('[SpotifyPlayer] Setting device ID from immediate check');
            setDeviceId(state.device.id);
            setIsReady(true);
          }
        } catch (error) {
          console.error('[SpotifyPlayer] Error in immediate state check:', error);
        }

        // Start periodic checks of player state
        if (initializationCheckInterval.current) {
          clearInterval(initializationCheckInterval.current);
        }
        initializationCheckInterval.current = setInterval(async () => {
          if (deviceId) {
            const isReady = await checkPlayerReady();
            if (!isReady) {
              console.log('[SpotifyPlayer] Periodic check: Player is not ready');
              reconnectPlayer();
            } else {
              console.log('[SpotifyPlayer] Periodic check: Player is ready');
              setIsReady(true);
            }
          }
        }, 10000); // Check every 10 seconds

      } catch (error) {
        if (!isMounted.current) return
        console.error('Error in Spotify player initialization:', error)
        setError(error instanceof Error ? error.message : 'Failed to initialize Spotify player')
        setIsReady(false)
      } finally {
        initializationPromise = null;
      }
    })();

    await initializationPromise;
  }

  useEffect(() => {
    // Define the callback before loading the SDK
    window.onSpotifyWebPlaybackSDKReady = initializePlayer

    // Only load the SDK if it hasn't been loaded yet
    if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true

      script.onerror = () => {
        if (!isMounted.current) return
        console.error('Failed to load Spotify Web Playback SDK')
        setError('Failed to load Spotify Web Playback SDK')
        setIsReady(false)
      }

      console.log('Loading Spotify Web Playback SDK...')
      document.body.appendChild(script)
    } else {
      console.log('Spotify Web Playback SDK already loaded, initializing player...')
      initializePlayer();
    }

    return () => {
      console.log('Cleaning up Spotify player...')
      isMounted.current = false
      if (initializationCheckInterval.current) {
        clearInterval(initializationCheckInterval.current);
      }
      // Don't disconnect the player here as it's a singleton
      // Only clean up the callback
      window.onSpotifyWebPlaybackSDKReady = () => {}
    }
  }, [setDeviceId, setIsReady, setPlaybackState])

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