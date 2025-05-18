/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { SpotifyPlayer } from '@/components/SpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { useSpotifyPlayerState } from '@/hooks/useSpotifyPlayerState'
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConsoleLogs } from '@/hooks/useConsoleLogs'
import { validateSongsBetweenRepeats } from './components/track-suggestions/validations/trackSuggestions'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import type { SpotifyPlayerInstance } from '@/types/spotify'
import { useTrackSuggestions } from './components/track-suggestions/hooks/useTrackSuggestions'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { useRecoverySystem } from './components/recovery/useRecoverySystem'
import { RecoveryStatus } from '@/components/ui/recovery-status'
import { HealthStatus } from '@/shared/types'
import { executeWithErrorBoundary } from '@/shared/utils/errorBoundary'
import { ApiError } from '@/shared/api'
import { SpotifyApiService } from '@/services/spotifyApi'
import {
  ensureDeviceHealth,
  transferPlaybackToDevice
} from '@/services/deviceManagement'

declare global {
  interface Window {
    refreshSpotifyPlayer: () => Promise<void>
    spotifyPlayerInstance: SpotifyPlayerInstance | null
    initializeSpotifyPlayer: () => Promise<void>
  }
}

const REFRESH_INTERVAL = 180000 // 3 minutes in milliseconds
const _DEVICE_CHECK_INTERVAL = {
  good: 30000, // 30 seconds
  unstable: 15000, // 15 seconds
  poor: 10000, // 10 seconds
  unknown: 5000 // 5 seconds for initial checks
}

// Update initialization constants
const INITIALIZATION_TIMEOUT = 30000 // 30 seconds max
const INITIALIZATION_CHECK_INTERVAL = 5000 // Check every 5 seconds
const INITIALIZATION_MAX_ATTEMPTS = 6 // Maximum number of initialization attempts
const INITIALIZATION_RATE_LIMIT_DELAY = 3000 // 3 seconds delay after rate limit
const SDK_READY_DELAY = 2000 // 2 seconds delay after SDK ready

interface _RecoveryState {
  lastSuccessfulPlayback: {
    trackUri: string | null
    position: number
    timestamp: number
  }
  consecutiveFailures: number
  lastErrorType: 'auth' | 'playback' | 'connection' | 'device' | null
}

interface PlaylistCheckedInfo {
  timestamp: number
  hasChanges: boolean
}

interface PlaybackInfo {
  isPlaying: boolean
  currentTrack: string
  progress: number
  duration_ms?: number
  timeUntilEnd?: number
  lastProgressCheck?: number
  progressStalled?: boolean
}

interface TokenInfo {
  expiryTime: number
  accessToken: string
}

interface RefreshResponse {
  success: boolean
  message?: string
  searchDetails?: {
    attempts: number
    totalTracksFound: number
    excludedTrackIds: string[]
    minPopularity: number
    genresTried: string[]
    trackDetails: Array<{
      name: string
      popularity: number
      isExcluded: boolean
      isPlayable: boolean
      duration_ms: number
      explicit: boolean
    }>
  }
}

interface _TrackSuggestionsTabProps {
  onStateChange: (state: TrackSuggestionsState) => void
}

interface _PlaybackVerificationResult {
  isSuccessful: boolean
  reason?: string
  details?: {
    deviceMatch: boolean
    isPlaying: boolean
    progressAdvancing: boolean
    contextMatch: boolean
    currentTrack?: string
    expectedTrack?: string
    timestamp: number
    verificationDuration: number
  }
}

// Add playback verification function
async function verifyPlaybackProgress(
  deviceId: string,
  maxStallTime: number = 5000 // 5 seconds
): Promise<{ isActuallyPlaying: boolean; progress: number }> {
  try {
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    if (!state?.device?.id || state.device.id !== deviceId) {
      return { isActuallyPlaying: false, progress: 0 }
    }

    const currentProgress = state.progress_ms ?? 0
    const isPlaying = state.is_playing ?? false

    if (!isPlaying) {
      return { isActuallyPlaying: false, progress: currentProgress }
    }

    // Wait a bit longer to ensure we can detect progress
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const newState = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    if (!newState?.device?.id || newState.device.id !== deviceId) {
      return { isActuallyPlaying: false, progress: currentProgress }
    }

    const newProgress = newState.progress_ms ?? 0
    const progressChanged = newProgress > currentProgress
    const timeSinceLastCheck = Date.now() - (state.timestamp ?? Date.now())

    // Consider it playing if:
    // 1. Progress has changed OR
    // 2. We're within the first 5 seconds of the track (might not see progress yet) OR
    // 3. We're near the end of the track (progress might be stalled)
    const isActuallyPlaying =
      progressChanged ||
      currentProgress < 5000 ||
      (newState.item?.duration_ms &&
        newState.item.duration_ms - currentProgress < 5000) ||
      timeSinceLastCheck < maxStallTime

    return {
      isActuallyPlaying,
      progress: newProgress
    }
  } catch (error) {
    console.error('[Playback Verification] Failed:', error)
    return { isActuallyPlaying: false, progress: 0 }
  }
}

export default function AdminPage(): JSX.Element {
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [_error, setError] = useState<string | null>(null)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [_isManualPause, setIsManualPause] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    device: 'unknown',
    playback: 'unknown',
    token: 'unknown',
    connection: 'unknown',
    tokenExpiringSoon: false,
    fixedPlaylist: 'unknown'
  })
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const { fixedPlaylistId } = useFixedPlaylist()
  const { recoveryStatus, recoveryAttempts } = useRecoverySystem(
    deviceId,
    fixedPlaylistId,
    (status) =>
      setHealthStatus((prev) => ({
        ...prev,
        device: status.device
      }))
  )
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const isRefreshing = useRef<boolean>(false)
  const _baseDelay = 2000 // 2 seconds
  const { logs: consoleLogs } = useConsoleLogs()
  const [uptime, setUptime] = useState(0)
  const [_currentYear, _setCurrentYear] = useState(new Date().getFullYear())
  const {
    state: trackSuggestionsState,
    updateState: updateTrackSuggestionsState
  } = useTrackSuggestions()
  const [isRefreshingSuggestions, setIsRefreshingSuggestions] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [_timeUntilRefresh, setTimeUntilRefresh] = useState(REFRESH_INTERVAL)
  const lastRefreshTime = useRef<number>(Date.now())
  const initializationTimeout = useRef<NodeJS.Timeout | null>(null)
  const initializationCheckInterval = useRef<NodeJS.Timeout | null>(null)

  const { refreshToken } = useSpotifyPlayerState(fixedPlaylistId ?? '')

  const _MAX_RECOVERY_ATTEMPTS = 5
  const _RECOVERY_STEPS = useMemo(
    () => [
      { message: 'Refreshing player state...', weight: 0.2 },
      { message: 'Ensuring active device...', weight: 0.2 },
      { message: 'Attempting to reconnect...', weight: 0.3 },
      { message: 'Reinitializing player...', weight: 0.3 }
    ],
    []
  )

  // Create refs for functions
  const handlePlaybackRef = useRef<
    ((action: 'play' | 'skip') => Promise<void>) | null
  >(null)
  const sendApiRequestWithTokenRecoveryRef = useRef<
    typeof sendApiRequestWithTokenRecovery | null
  >(null)

  // Move handleApiError before sendApiRequestWithTokenRecovery
  const handleApiError = useCallback(
    (error: unknown): void => {
      console.error('[API Error]', error)
      if (error instanceof Error) {
        if (error.message.includes('token')) {
          setHealthStatus((prev) => ({ ...prev, auth: 'error' }))
        } else if (error.message.includes('device')) {
          setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        } else if (error.message.includes('playback')) {
          setHealthStatus((prev) => ({ ...prev, playback: 'error' }))
        }
      }
    },
    [setHealthStatus]
  )

  // Wrap sendApiRequestWithTokenRecovery in useCallback
  const sendApiRequestWithTokenRecovery = useCallback(
    async <T,>(request: Parameters<typeof sendApiRequest>[0]): Promise<T> => {
      try {
        return await sendApiRequest<T>(request)
      } catch (error) {
        handleApiError(error)
        throw error
      }
    },
    [handleApiError]
  )

  // Update the ref when sendApiRequestWithTokenRecovery changes
  useEffect(() => {
    sendApiRequestWithTokenRecoveryRef.current = sendApiRequestWithTokenRecovery
  }, [sendApiRequestWithTokenRecovery])

  // Update handlePlayback dependencies
  const handlePlayback = useCallback(
    async (action: 'play' | 'skip'): Promise<void> => {
      if (isInitializing) {
        console.log(
          '[Spotify] Skipping playback action - player still initializing'
        )
        return
      }

      setIsLoading(true)
      try {
        setError(null)

        console.log('[Spotify] Starting playback sequence')

        // First, ensure we have a valid device ID
        if (!deviceId) {
          console.error('[Spotify] No device ID available')
          throw new Error('No device ID available')
        }

        // Get current state first
        const state = await executeWithErrorBoundary(async () => {
          const response = await sendApiRequestWithTokenRecoveryRef.current?.({
            path: 'me/player',
            method: 'GET'
          })
          if (!response) {
            throw new Error('Failed to get playback state')
          }
          return response as SpotifyPlaybackState
        }, 'Playback')

        if (!state) {
          throw new Error('Failed to get playback state')
        }

        console.log('[Spotify] Current playback state:', {
          isPlaying: state.is_playing,
          deviceId: state.device?.id,
          currentDeviceId: deviceId,
          timestamp: Date.now()
        })

        // Ensure our device is active before proceeding using our new service
        if (!state?.device?.id || state.device.id !== deviceId) {
          console.log('[Spotify] Ensuring device is active')
          try {
            const transferred = await transferPlaybackToDevice(deviceId)
            if (!transferred) {
              throw new Error('Device transfer failed')
            }
            console.log('[Spotify] Device transfer successful')
          } catch (error) {
            console.error('[Spotify] Device transfer failed:', error)
            // If device transfer fails, try to refresh the player
            if (typeof window.refreshSpotifyPlayer === 'function') {
              console.log('[Spotify] Attempting to refresh player')
              await window.refreshSpotifyPlayer()
              // Wait a bit for the refresh to take effect
              await new Promise((resolve) => setTimeout(resolve, 1000))

              // Try device transfer again using our new service
              const retryTransfer = await transferPlaybackToDevice(deviceId)
              if (!retryTransfer) {
                throw new Error('Device transfer failed after refresh')
              }
            }
          }
        }

        if (action === 'play') {
          // If currently playing, pause the playback
          if (state?.is_playing) {
            console.log('[Spotify] Pausing playback')
            await sendApiRequest({
              path: `me/player/pause?device_id=${deviceId}`,
              method: 'PUT'
            })
            setHealthStatus((prev: HealthStatus) => ({
              ...prev,
              playback: 'paused'
            }))
            setPlaybackInfo((prev) =>
              prev ? { ...prev, isPlaying: false } : null
            )
            setIsManualPause(true) // Set manual pause flag
          } else {
            // Check if the current track is playable
            if (state?.item?.is_playable === false) {
              console.log(
                '[Spotify] Current track is not playable, skipping to next track'
              )
              await sendApiRequest({
                path: `me/player/next?device_id=${deviceId}`,
                method: 'POST'
              })
              return
            }

            console.log('[Spotify] Starting playback with state:', {
              device_id: deviceId,
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: state?.progress_ms ?? 0,
              offset: state?.item?.uri ? { uri: state.item.uri } : undefined
            })

            try {
              const spotifyApi = SpotifyApiService.getInstance()
              await spotifyApi.resumePlaybackAtPosition({
                deviceId,
                contextUri: `spotify:playlist:${fixedPlaylistId}`,
                trackUri: state?.item?.uri,
                position: state?.progress_ms ?? 0
              })
              setHealthStatus((prev: HealthStatus) => ({
                ...prev,
                playback: 'playing'
              }))
              setPlaybackInfo((prev) =>
                prev ? { ...prev, isPlaying: true } : null
              )
              setIsManualPause(false) // Clear manual pause flag
            } catch (playError) {
              if (
                playError instanceof Error &&
                playError.message.includes('Restriction violated')
              ) {
                console.log(
                  '[Spotify] Playback restricted, skipping to next track'
                )
                await sendApiRequest({
                  path: `me/player/next?device_id=${deviceId}`,
                  method: 'POST'
                })
                return
              }
              throw playError
            }
          }
        } else {
          console.log('[Spotify] Skipping to next track')
          await sendApiRequest({
            path: `me/player/next?device_id=${deviceId}`,
            method: 'POST'
          })
        }

        console.log('[Spotify] Playback action completed successfully')
      } catch (error) {
        console.error('[Spotify] Playback control failed:', error)
        setError('Failed to control playback')
        setHealthStatus((prev: HealthStatus) => ({
          ...prev,
          playback: 'error'
        }))
        // Reset playback state on error
        setPlaybackInfo((prev) => (prev ? { ...prev, isPlaying: false } : null))

        // Attempt automatic recovery
        try {
          console.log('[Spotify] Attempting recovery...')
          await executeWithErrorBoundary(async () => {
            // First try to refresh the player state
            if (typeof window.refreshSpotifyPlayer === 'function') {
              await window.refreshSpotifyPlayer()
            }

            // Then try to reconnect the player
            if (typeof window.spotifyPlayerInstance?.connect === 'function') {
              await window.spotifyPlayerInstance.connect()
            }

            // Finally try the original playback action again
            if (action === 'play') {
              await handlePlaybackRef.current?.('play')
            } else {
              await handlePlaybackRef.current?.('skip')
            }
          }, 'Playback Recovery')
        } catch (recoveryError) {
          console.error('[Spotify] Recovery failed:', recoveryError)
        }
      } finally {
        // Always clear loading state
        setIsLoading(false)
      }
    },
    [
      isInitializing,
      deviceId,
      fixedPlaylistId,
      setHealthStatus,
      setIsLoading,
      setError,
      setIsManualPause
    ]
  )

  // Update the ref when handlePlayback changes
  useEffect(() => {
    handlePlaybackRef.current = handlePlayback
  }, [handlePlayback])

  // Declare handleRefresh first
  const handleRefresh = useCallback(
    async (source: 'auto' | 'manual' = 'manual'): Promise<void> => {
      if (isRefreshing.current) {
        console.log(`[Refresh] Skipping ${source} refresh - already refreshing`)
        return
      }

      console.log(`[Refresh] Starting ${source} refresh`)
      isRefreshing.current = true
      setIsLoading(true)
      setError(null)

      try {
        // Use trackSuggestionsState from the hook
        if (!trackSuggestionsState) {
          console.error('[Refresh] No track suggestions state available')
          throw new Error('No track suggestions state available')
        }

        // Get the PlaylistRefreshService instance
        const playlistRefreshService = PlaylistRefreshServiceImpl.getInstance()

        // Call the service's refreshTrackSuggestions method
        const result = await playlistRefreshService.refreshTrackSuggestions({
          genres: trackSuggestionsState.genres,
          yearRange: trackSuggestionsState.yearRange,
          popularity: trackSuggestionsState.popularity,
          allowExplicit: trackSuggestionsState.allowExplicit,
          maxSongLength: trackSuggestionsState.maxSongLength,
          songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats,
          maxOffset: trackSuggestionsState.maxOffset
        })

        if (!result.success) {
          throw new Error(result.message)
        }

        console.log(
          `[Refresh] ${source} refresh completed successfully - added suggested song`
        )
      } catch (err) {
        console.error(`[Refresh] ${source} refresh error:`, err)
      } finally {
        setIsLoading(false)
        isRefreshing.current = false
      }
    },
    [trackSuggestionsState]
  )

  // Now we can safely create the ref
  const handleRefreshRef = useRef(handleRefresh)

  // Update the ref when handleRefresh changes
  useEffect(() => {
    handleRefreshRef.current = handleRefresh
  }, [handleRefresh])

  // Move cleanup effect to be with other effects
  useEffect(() => {
    // Initial setup
    setMounted(true)

    // Store ref values in variables
    const currentRecoveryTimeout = recoveryTimeout.current
    const currentInitializationCheckInterval =
      initializationCheckInterval.current

    // Cleanup function
    return () => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
      if (currentRecoveryTimeout) {
        clearTimeout(currentRecoveryTimeout)
      }
      if (initializationTimeout.current) {
        clearTimeout(initializationTimeout.current)
      }
      if (currentInitializationCheckInterval) {
        clearInterval(currentInitializationCheckInterval)
      }
    }
  }, [])

  // Add a new effect to update device status when ready state changes
  useEffect(() => {
    if (isReady && deviceId) {
      console.log(
        '[Device] Player ready state changed, updating health status:',
        {
          deviceId,
          isReady,
          timestamp: Date.now()
        }
      )
      // Only set to healthy if we have both isReady and deviceId and we're not initializing
      if (!isInitializing) {
        setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
        setIsLoading(false)
      }
    } else if (!isReady || !deviceId) {
      // Set to disconnected if we don't have both isReady and deviceId
      setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
    }
  }, [isReady, deviceId, isInitializing])

  // Add a new state for device check status
  const [isDeviceCheckComplete, setIsDeviceCheckComplete] = useState(false)

  // Add initialization state tracking
  const initializationState = useRef({
    isComplete: false,
    lastAttempt: 0,
    consecutiveRateLimits: 0,
    maxConsecutiveRateLimits: 3,
    sdkReadyCount: 0,
    requiredSdkReadyCount: 1 // Reduced to 1 since we're getting ready events from the player
  }).current

  // Update initialization check
  useEffect(() => {
    if (!mounted || initializationState.isComplete) return

    let initializationAttempts = 0

    const checkInitialization = async (): Promise<void> => {
      try {
        // Check if we've hit too many consecutive rate limits
        if (
          initializationState.consecutiveRateLimits >=
          initializationState.maxConsecutiveRateLimits
        ) {
          console.log(
            '[Initialization] Too many consecutive rate limits, forcing completion'
          )
          setIsInitializing(false)
          initializationState.isComplete = true
          setIsDeviceCheckComplete(true)
          return
        }

        // Add delay between attempts
        const timeSinceLastAttempt =
          Date.now() - initializationState.lastAttempt
        if (timeSinceLastAttempt < INITIALIZATION_RATE_LIMIT_DELAY) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              INITIALIZATION_RATE_LIMIT_DELAY - timeSinceLastAttempt
            )
          )
        }

        console.log('[Initialization] Checking player state:', {
          isReady,
          deviceId,
          isInitializing,
          attempt: initializationAttempts + 1,
          sdkReadyCount: initializationState.sdkReadyCount,
          timestamp: new Date().toISOString()
        })

        // First check if we have enough SDK ready events
        if (
          initializationState.sdkReadyCount <
          initializationState.requiredSdkReadyCount
        ) {
          console.log('[Initialization] Waiting for SDK ready events...')
          initializationAttempts++
          if (initializationAttempts >= INITIALIZATION_MAX_ATTEMPTS) {
            console.log(
              '[Initialization] Max attempts reached, forcing initialization complete'
            )
            setIsInitializing(false)
            initializationState.isComplete = true
            setIsDeviceCheckComplete(true)
            return
          }
          return
        }

        // Then check if we have a device ID
        if (!deviceId) {
          console.log('[Initialization] Waiting for device ID...')
          initializationAttempts++
          if (initializationAttempts >= INITIALIZATION_MAX_ATTEMPTS) {
            console.log(
              '[Initialization] Max attempts reached, forcing initialization complete'
            )
            setIsInitializing(false)
            initializationState.isComplete = true
            setIsDeviceCheckComplete(true)
            return
          }
          return
        }

        // Then check if the player is ready
        if (!isReady) {
          console.log('[Initialization] Waiting for player to be ready...')
          initializationAttempts++
          if (initializationAttempts >= INITIALIZATION_MAX_ATTEMPTS) {
            console.log(
              '[Initialization] Max attempts reached, forcing initialization complete'
            )
            setIsInitializing(false)
            initializationState.isComplete = true
            setIsDeviceCheckComplete(true)
            return
          }
          return
        }

        // Add a longer delay between API calls during initialization
        await new Promise((resolve) =>
          setTimeout(resolve, INITIALIZATION_RATE_LIMIT_DELAY)
        )

        try {
          const response = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET',
            debounceTime: 5000 // 5 second debounce
          })

          console.log('[Initialization] Player state response:', {
            hasDevice: !!response?.device,
            deviceId: response?.device?.id,
            expectedDeviceId: deviceId,
            timestamp: new Date().toISOString()
          })

          if (response?.device?.id === deviceId) {
            console.log('[Initialization] Player initialized successfully')
            setIsInitializing(false)
            initializationState.isComplete = true
            setIsDeviceCheckComplete(true)
            if (initializationTimeout.current) {
              clearTimeout(initializationTimeout.current)
            }
            setHealthStatus((prev) => ({
              ...prev,
              device: 'healthy',
              playback: response.is_playing ? 'playing' : 'paused'
            }))
          } else {
            console.log(
              '[Initialization] Device mismatch, waiting for correct device...'
            )
            initializationAttempts++
            if (initializationAttempts >= INITIALIZATION_MAX_ATTEMPTS) {
              console.log(
                '[Initialization] Max attempts reached, forcing initialization complete'
              )
              setIsInitializing(false)
              initializationState.isComplete = true
              setIsDeviceCheckComplete(true)
            }
          }
        } catch (error: unknown) {
          if (error instanceof ApiError && error.status === 429) {
            console.log('[Initialization] Rate limited during initialization')
            initializationState.consecutiveRateLimits++
            initializationState.lastAttempt = Date.now()

            // If we've hit too many consecutive rate limits, force completion
            if (
              initializationState.consecutiveRateLimits >=
              initializationState.maxConsecutiveRateLimits
            ) {
              console.log(
                '[Initialization] Too many consecutive rate limits, forcing completion'
              )
              setIsInitializing(false)
              initializationState.isComplete = true
              setIsDeviceCheckComplete(true)
              return
            }
          } else {
            console.error('[Initialization] Check failed:', error)
            initializationAttempts++
            if (initializationAttempts >= INITIALIZATION_MAX_ATTEMPTS) {
              console.log(
                '[Initialization] Max attempts reached, forcing initialization complete'
              )
              setIsInitializing(false)
              initializationState.isComplete = true
              setIsDeviceCheckComplete(true)
            }
          }
        }
      } catch (error) {
        console.error('[Initialization] Check failed:', error)
        initializationAttempts++
        if (initializationAttempts >= INITIALIZATION_MAX_ATTEMPTS) {
          console.log(
            '[Initialization] Max attempts reached, forcing initialization complete'
          )
          setIsInitializing(false)
          initializationState.isComplete = true
          setIsDeviceCheckComplete(true)
        }
      }
    }

    // Set a timeout to force initialization complete after INITIALIZATION_TIMEOUT
    initializationTimeout.current = setTimeout(() => {
      console.log(
        '[Initialization] Forcing initialization complete after timeout'
      )
      setIsInitializing(false)
      initializationState.isComplete = true
      setIsDeviceCheckComplete(true)
    }, INITIALIZATION_TIMEOUT)

    // Check immediately and then every INITIALIZATION_CHECK_INTERVAL
    void checkInitialization()
    const interval = setInterval(() => {
      if (!initializationState.isComplete) {
        void checkInitialization()
      } else {
        clearInterval(interval)
      }
    }, INITIALIZATION_CHECK_INTERVAL)

    return () => {
      if (initializationTimeout.current) {
        clearTimeout(initializationTimeout.current)
      }
      clearInterval(interval)
    }
  }, [mounted, deviceId, isReady, isInitializing, initializationState])

  // Add SDK ready event handler
  useEffect(() => {
    const handleSdkReady = () => {
      console.log('[SpotifyPlayer] SDK Ready event received')
      initializationState.sdkReadyCount++

      // Add a delay after SDK ready before proceeding
      setTimeout(() => {
        if (!initializationState.isComplete) {
          console.log(
            '[Initialization] SDK ready delay complete, continuing initialization'
          )
        }
      }, SDK_READY_DELAY)
    }

    // Listen for both custom event and window property
    window.addEventListener('spotify-sdk-ready', handleSdkReady)

    // Also check if SDK is already ready
    if (window.spotifyPlayerInstance?.connect) {
      handleSdkReady()
    }

    return () => {
      window.removeEventListener('spotify-sdk-ready', handleSdkReady)
    }
  }, [initializationState.isComplete, initializationState.sdkReadyCount])

  // Update device check to be more conservative with API calls
  useEffect(() => {
    if (!deviceId || !isReady || isInitializing) return

    const initialDelay = setTimeout(() => {
      void checkDevice(deviceId)
    }, 5000) // 5 second initial delay

    async function checkDevice(deviceId: string | null): Promise<void> {
      if (!deviceId) {
        console.error('[Device Check] No device ID available')
        return
      }

      try {
        const health = await ensureDeviceHealth(deviceId, {
          maxAttempts: 3,
          delayBetweenAttempts: 1000,
          requireActive: true
        })

        if (!health.isHealthy) {
          console.error('[Device Check] Device is unhealthy:', health.errors)
          setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
          return
        }

        if (!health.isActive) {
          console.log(
            '[Device Check] Device is not active, attempting transfer'
          )
          const transferred = await transferPlaybackToDevice(deviceId)
          if (!transferred) {
            console.error(
              '[Device Check] Failed to transfer playback to device'
            )
            setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
            return
          }
        }

        console.log('[Device Check] Device is healthy and active')
        setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
      } catch (error) {
        console.error('[Device Check] Error checking device:', error)
        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
      }
    }

    // Update device check interval to be less frequent
    deviceCheckInterval.current = setInterval(() => {
      void checkDevice(deviceId)
    }, 120000) // Increased to 2 minutes

    return () => {
      clearTimeout(initialDelay)
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
    }
  }, [deviceId, isReady, isInitializing])

  // Request wake lock to prevent device sleep
  useEffect(() => {
    const requestWakeLock = async (): Promise<void> => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock.current = await navigator.wakeLock.request('screen')
        }
      } catch (error) {
        console.error('[WakeLock] Failed:', error)
      }
    }

    void requestWakeLock()

    return (): void => {
      if (wakeLock.current) {
        void wakeLock.current.release()
      }
    }
  }, [])

  // Fix the playlist checked handler
  const handlePlaylistChecked = useCallback(
    (event: CustomEvent<PlaylistCheckedInfo>): void => {
      const { hasChanges } = event.detail
      if (hasChanges) {
        void handleRefresh()
      }
    },
    [handleRefresh]
  )

  // Listen for playlist change status updates
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const playlistEffect = () => {
    window.addEventListener(
      'playlistChecked',
      handlePlaylistChecked as EventListener
    )
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    return () => {
      window.removeEventListener(
        'playlistChecked',
        handlePlaylistChecked as EventListener
      )
    }
  }

  useEffect(playlistEffect, [handlePlaylistChecked])

  // Uptime timer
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  useEffect(() => {
    const startTime = Date.now()
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const timer = setInterval(() => {
      setUptime(Date.now() - startTime)
    }, 1000)

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    return () => clearInterval(timer)
  }, [])

  // Update FixedPlaylist status
  useEffect(() => {
    if (fixedPlaylistId) {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'found' }))
    } else {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'not_found' }))
    }
  }, [fixedPlaylistId])

  // Monitor connection quality
  useEffect(() => {
    if (!mounted) return

    // Define Network Information API types
    interface NetworkInformation extends EventTarget {
      readonly type?:
        | 'bluetooth'
        | 'cellular'
        | 'ethernet'
        | 'none'
        | 'wifi'
        | 'wimax'
        | 'other'
        | 'unknown'
      readonly effectiveType?: 'slow-2g' | '2g' | '3g' | '4g'
      readonly downlink?: number
      readonly rtt?: number
      readonly saveData?: boolean
      onchange?: (this: NetworkInformation, ev: Event) => void
    }

    const updateConnectionStatus = (): void => {
      if (!navigator.onLine) {
        console.log('[Connection] Device is offline')
        setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        return
      }

      // Check connection type and effective type if available
      const connection = (navigator as { connection?: NetworkInformation })
        .connection
      if (connection) {
        const { effectiveType, downlink, rtt } = connection
        console.log('[Connection] Network info:', {
          effectiveType,
          downlink,
          rtt,
          type: connection.type
        })

        // Default to 'good' for ethernet and wifi connections
        if (connection.type === 'ethernet' || connection.type === 'wifi') {
          console.log('[Connection] Using ethernet/wifi, marking as good')
          setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
          return
        }

        // For other connection types, use effectiveType and metrics
        if (
          effectiveType === '4g' &&
          downlink &&
          downlink >= 2 &&
          rtt &&
          rtt < 100
        ) {
          console.log('[Connection] Good 4G connection')
          setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
        } else if (effectiveType === '3g' && downlink && downlink >= 1) {
          console.log('[Connection] Unstable 3G connection')
          setHealthStatus((prev) => ({ ...prev, connection: 'unstable' }))
        } else {
          console.log('[Connection] Poor connection')
          setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        }
      } else {
        // If Network Information API is not available, use online status
        console.log(
          '[Connection] Network API not available, using online status'
        )
        setHealthStatus((prev) => ({
          ...prev,
          connection: navigator.onLine ? 'good' : 'poor'
        }))
      }
    }

    // Initial status update
    updateConnectionStatus()

    // Listen for online/offline events
    window.addEventListener('online', updateConnectionStatus)
    window.addEventListener('offline', updateConnectionStatus)

    // Listen for connection changes if available
    const connection = (navigator as { connection?: NetworkInformation })
      .connection
    if (connection) {
      connection.addEventListener('change', updateConnectionStatus)
    }

    return () => {
      window.removeEventListener('online', updateConnectionStatus)
      window.removeEventListener('offline', updateConnectionStatus)
      if (connection) {
        connection.removeEventListener('change', updateConnectionStatus)
      }
    }
  }, [mounted])

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    const remainingSeconds = seconds % 60

    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
    }
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`
    }
    return `${seconds}s`
  }

  // Add a new effect to handle Spotify player ready state
  useEffect(() => {
    if (isReady) {
      console.log('[Spotify Player] Ready state changed:', {
        isReady,
        deviceId,
        timestamp: new Date().toISOString()
      })
    }
  }, [isReady, deviceId])

  // Add a new effect to handle device ID changes
  useEffect(() => {
    if (deviceId) {
      console.log('[Spotify Player] Device ID changed:', {
        deviceId,
        isReady,
        timestamp: new Date().toISOString()
      })
    }
  }, [deviceId, isReady])

  const handleTrackSuggestionsRefresh = async (): Promise<void> => {
    if (!trackSuggestionsState) {
      return
    }

    // Validate required fields
    const {
      genres,
      yearRange,
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats
    } = trackSuggestionsState

    if (!Array.isArray(genres) || genres.length === 0 || genres.length > 10) {
      setRefreshError('Invalid genres: must have between 1 and 10 genres')
      return
    }

    if (!Array.isArray(yearRange) || yearRange.length !== 2) {
      setRefreshError('Invalid year range: must be an array of two numbers')
      return
    }

    const [startYear, endYear] = yearRange
    if (startYear < 1900 || endYear > new Date().getFullYear()) {
      setRefreshError(
        `Invalid year range: must be between 1900 and ${new Date().getFullYear()}`
      )
      return
    }

    if (typeof popularity !== 'number' || popularity < 0 || popularity > 100) {
      setRefreshError('Invalid popularity: must be between 0 and 100')
      return
    }

    if (
      typeof maxSongLength !== 'number' ||
      maxSongLength < 30 ||
      maxSongLength > 600
    ) {
      setRefreshError(
        'Invalid max song length: must be between 30 and 600 seconds'
      )
      return
    }

    const songsBetweenRepeatsError =
      validateSongsBetweenRepeats(songsBetweenRepeats)
    if (songsBetweenRepeatsError) {
      setRefreshError(songsBetweenRepeatsError)
      return
    }

    setIsRefreshingSuggestions(true)
    setRefreshError(null)

    try {
      // Strip out optional fields and send only required ones
      const requestBody = {
        genres,
        yearRange,
        popularity,
        allowExplicit,
        maxSongLength,
        songsBetweenRepeats,
        maxOffset: trackSuggestionsState.maxOffset
      }

      const response = await fetch('/api/track-suggestions/refresh-site', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = (await response.json()) as { message?: string }
        throw new Error(
          errorData.message ?? `HTTP error! status: ${response.status}`
        )
      }

      const data = (await response.json()) as RefreshResponse

      if (data.success) {
        console.log(
          'Track suggestions refreshed successfully',
          JSON.stringify(data.searchDetails)
        )
      } else {
        throw new Error(data.message ?? 'Failed to refresh track suggestions')
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'
      setRefreshError(errorMessage)
    } finally {
      setIsRefreshingSuggestions(false)
    }
  }

  const handleTrackSuggestionsStateChange = (
    newState: TrackSuggestionsState
  ): void => {
    updateTrackSuggestionsState(newState)
  }

  // Update the refresh timer effect
  useEffect(() => {
    const timer = setInterval(() => {
      const timeSinceLastRefresh = Date.now() - lastRefreshTime.current
      const remainingTime = REFRESH_INTERVAL - timeSinceLastRefresh

      setTimeUntilRefresh(remainingTime)

      if (timeSinceLastRefresh >= REFRESH_INTERVAL) {
        void handleRefresh('auto')
        lastRefreshTime.current = Date.now()
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [handleRefresh])

  // Fix the playback update handler
  const handlePlaybackUpdate = useCallback(
    (event: Event): void => {
      const customEvent = event as CustomEvent<PlaybackInfo>
      if (!deviceId) {
        console.log('[Playback] Ignoring update - no device ID:', {
          timestamp: new Date().toISOString()
        })
        return
      }

      void (async () => {
        // Verify device is still active and playback is actually progressing
        const { isActuallyPlaying, progress } =
          await verifyPlaybackProgress(deviceId)

        if (isActuallyPlaying) {
          setPlaybackInfo({
            ...customEvent.detail,
            isPlaying: true,
            progress,
            lastProgressCheck: Date.now(),
            progressStalled: false
          })
          setHealthStatus((prev) => ({
            ...prev,
            playback: 'playing'
          }))

          // Check if track is about to finish (less than 15 seconds remaining)
          if (
            customEvent.detail.timeUntilEnd &&
            customEvent.detail.timeUntilEnd < 15000
          ) {
            console.log('[Playback] Track ending soon, refreshing playlist:', {
              timeUntilEnd: customEvent.detail.timeUntilEnd,
              currentTrack: customEvent.detail.currentTrack,
              timestamp: new Date().toISOString()
            })

            // Get the PlaylistRefreshService instance
            const playlistRefreshService =
              PlaylistRefreshServiceImpl.getInstance()

            // Call refreshTrackSuggestions
            void playlistRefreshService.refreshTrackSuggestions({
              genres: trackSuggestionsState.genres,
              yearRange: trackSuggestionsState.yearRange,
              popularity: trackSuggestionsState.popularity,
              allowExplicit: trackSuggestionsState.allowExplicit,
              maxSongLength: trackSuggestionsState.maxSongLength,
              songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats,
              maxOffset: trackSuggestionsState.maxOffset
            })
          }
        } else {
          setPlaybackInfo({
            ...customEvent.detail,
            isPlaying: false,
            progress,
            lastProgressCheck: Date.now(),
            progressStalled: true
          })
          setHealthStatus((prev) => ({
            ...prev,
            playback: 'paused'
          }))
        }
      })()
    },
    [deviceId, trackSuggestionsState]
  )

  // Update the event listener setup
  useEffect(() => {
    window.addEventListener('playbackUpdate', handlePlaybackUpdate)
    return () => {
      window.removeEventListener('playbackUpdate', handlePlaybackUpdate)
    }
  }, [handlePlaybackUpdate])

  // Add initial playback state check
  useEffect(() => {
    if (!deviceId || !isReady) return

    const checkInitialPlaybackState = async (): Promise<void> => {
      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (state?.item) {
          const { isActuallyPlaying, progress } =
            await verifyPlaybackProgress(deviceId)
          setPlaybackInfo({
            isPlaying: isActuallyPlaying,
            currentTrack: state.item.name,
            progress,
            duration_ms: state.item.duration_ms,
            timeUntilEnd: state.item.duration_ms - progress,
            lastProgressCheck: Date.now(),
            progressStalled: !isActuallyPlaying
          })
          setHealthStatus((prev) => ({
            ...prev,
            playback: isActuallyPlaying ? 'playing' : 'paused'
          }))
        }
      } catch (error) {
        console.error('[Playback] Failed to get initial state:', error)
        setHealthStatus((prev) => ({
          ...prev,
          playback: 'paused'
        }))
      }
    }

    void checkInitialPlaybackState()
  }, [deviceId, isReady])

  // Monitor token status
  useEffect(() => {
    const handleTokenUpdate = (event: CustomEvent<TokenInfo>): void => {
      const { expiryTime } = event.detail
      const now = Date.now()
      const timeUntilExpiry = expiryTime - now
      const isExpiringSoon = timeUntilExpiry < 15 * 60 * 1000 // 15 minutes

      console.log('[Token] Status update:', {
        timeUntilExpiry,
        isExpiringSoon,
        timestamp: new Date().toISOString()
      })

      setHealthStatus((prev) => ({
        ...prev,
        token: 'valid',
        tokenExpiringSoon: isExpiringSoon
      }))
    }

    // Set initial token status
    setHealthStatus((prev) => ({
      ...prev,
      token: 'valid',
      tokenExpiringSoon: false
    }))

    window.addEventListener('tokenUpdate', handleTokenUpdate as EventListener)
    return () => {
      window.removeEventListener(
        'tokenUpdate',
        handleTokenUpdate as EventListener
      )
    }
  }, [])

  // Move these hooks before any conditional returns
  const handlePlaybackClick = useCallback(() => {
    void handlePlayback('play')
  }, [handlePlayback])

  const handleSkipClick = useCallback(() => {
    void handlePlayback('skip')
  }, [handlePlayback])

  const handleRefreshClick = useCallback(() => {
    void handleRefresh('manual')
  }, [handleRefresh])

  // Add loading state to UI
  if (!mounted || isInitializing) {
    return (
      <div className='text-white min-h-screen bg-black p-4'>
        <div className='flex h-screen items-center justify-center'>
          <div className='text-center'>
            <div className='mb-4 text-lg'>Initializing Spotify Player...</div>
            <div className='border-white mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-t-2'></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='text-white min-h-screen bg-black p-4'>
      <SpotifyPlayer />
      <RecoveryStatus {...recoveryStatus} />

      <div className='mx-auto max-w-xl space-y-4'>
        <h1 className='mb-8 text-2xl font-bold'>Admin Controls</h1>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className='space-y-4'
        >
          <TabsList className='grid w-full grid-cols-2 bg-gray-800/50'>
            <TabsTrigger
              value='dashboard'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value='track-suggestions'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Track Suggestions
            </TabsTrigger>
          </TabsList>

          <TabsContent value='dashboard'>
            {_error && (
              <div className='mb-4 rounded border border-red-500 bg-red-900/50 p-4 text-red-100'>
                {_error}
              </div>
            )}

            <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
              <div
                className={`h-3 w-3 rounded-full ${isReady ? 'bg-green-500' : 'bg-yellow-500'}`}
              />
              <span className='font-medium'>
                {isReady ? 'Player Ready' : 'Player Initializing...'}
              </span>
            </div>

            <div className='space-y-4'>
              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.device === 'healthy'
                      ? 'bg-green-500'
                      : healthStatus.device === 'unresponsive'
                        ? 'bg-yellow-500'
                        : healthStatus.device === 'disconnected'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.device === 'healthy'
                    ? 'Device Connected'
                    : healthStatus.device === 'unresponsive'
                      ? 'Device Unresponsive'
                      : healthStatus.device === 'disconnected'
                        ? 'Device Disconnected'
                        : 'Device Status Unknown'}
                  {recoveryAttempts > 0 && ` (Recovery ${recoveryAttempts}/5)`}
                </span>
              </div>

              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.playback === 'playing'
                      ? 'animate-pulse bg-green-500'
                      : healthStatus.playback === 'paused'
                        ? 'bg-yellow-500'
                        : healthStatus.playback === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <div className='flex flex-1 flex-col gap-2'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>
                      {healthStatus.playback === 'playing'
                        ? 'Playback Active'
                        : healthStatus.playback === 'paused'
                          ? 'Playback Paused'
                          : healthStatus.playback === 'error'
                            ? 'Playback Error'
                            : 'Playback Stopped'}
                    </span>
                    {playbackInfo?.currentTrack && (
                      <span className='text-sm text-gray-400'>
                        -{' '}
                        <span className='text-white font-medium'>
                          {playbackInfo.currentTrack}
                        </span>
                      </span>
                    )}
                  </div>
                  {playbackInfo?.duration_ms && (
                    <div className='space-y-1'>
                      <div className='relative h-1.5 overflow-hidden rounded-full bg-gray-700'>
                        <div
                          className='absolute left-0 top-0 h-full bg-green-500 transition-all duration-1000 ease-linear'
                          style={{
                            width: `${(playbackInfo.progress / playbackInfo.duration_ms) * 100}%`
                          }}
                        />
                      </div>
                      <div className='flex justify-between text-xs text-gray-500'>
                        <span>{formatTime(playbackInfo.progress)}</span>
                        <span>{formatTime(playbackInfo.duration_ms)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.token === 'valid' &&
                    !healthStatus.tokenExpiringSoon
                      ? 'bg-green-500'
                      : healthStatus.token === 'valid' &&
                          healthStatus.tokenExpiringSoon
                        ? 'bg-yellow-500'
                        : healthStatus.token === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.token === 'valid' &&
                  !healthStatus.tokenExpiringSoon
                    ? 'Token Valid'
                    : healthStatus.token === 'valid' &&
                        healthStatus.tokenExpiringSoon
                      ? 'Token Expiring Soon'
                      : healthStatus.token === 'error'
                        ? 'Token Error'
                        : 'Token Status Unknown'}
                </span>
              </div>

              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.connection === 'good'
                      ? 'bg-green-500'
                      : healthStatus.connection === 'unstable'
                        ? 'bg-yellow-500'
                        : healthStatus.connection === 'poor'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.connection === 'good'
                    ? 'Connection Good'
                    : healthStatus.connection === 'unstable'
                      ? 'Connection Unstable'
                      : healthStatus.connection === 'poor'
                        ? 'Connection Poor'
                        : 'Connection Status Unknown'}
                </span>
              </div>

              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.fixedPlaylist === 'found'
                      ? 'bg-green-500'
                      : healthStatus.fixedPlaylist === 'not_found'
                        ? 'bg-red-500'
                        : healthStatus.fixedPlaylist === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.fixedPlaylist === 'found'
                    ? 'Fixed Playlist Found'
                    : healthStatus.fixedPlaylist === 'not_found'
                      ? 'Fixed Playlist Not Found'
                      : healthStatus.fixedPlaylist === 'error'
                        ? 'Fixed Playlist Error'
                        : 'Fixed Playlist Status Unknown'}
                </span>
              </div>
            </div>

            <div className='mt-8 space-y-4'>
              <h2 className='text-xl font-semibold'>Controls</h2>
              <div className='flex gap-4'>
                <button
                  onClick={handlePlaybackClick}
                  disabled={isLoading || !isReady || !isDeviceCheckComplete}
                  className='text-white flex-1 rounded-lg bg-green-600 px-4 py-2 font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : !isDeviceCheckComplete
                      ? 'Initializing...'
                      : playbackInfo?.isPlaying
                        ? 'Pause'
                        : 'Play'}
                </button>
                <button
                  onClick={handleSkipClick}
                  disabled={isLoading || !isReady || !isDeviceCheckComplete}
                  className='text-white flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : !isDeviceCheckComplete
                      ? 'Initializing...'
                      : 'Skip'}
                </button>
                <button
                  onClick={handleRefreshClick}
                  disabled={isLoading || isRefreshingSuggestions}
                  className='text-white flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : !isDeviceCheckComplete
                      ? 'Initializing...'
                      : 'Refresh Playlist'}
                </button>
                <button
                  onClick={() => void refreshToken()}
                  disabled={isLoading || !isReady || !isDeviceCheckComplete}
                  className='text-white flex-1 rounded-lg bg-orange-600 px-4 py-2 font-medium transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : !isDeviceCheckComplete
                      ? 'Initializing...'
                      : 'Refresh Token'}
                </button>
              </div>
              <div className='text-center text-sm text-gray-400'>
                <div className='flex flex-col items-center gap-2'>
                  <span>Uptime: {formatTime(uptime)}</span>
                </div>
              </div>
              <div className='mt-4'>
                <h3 className='mb-2 text-lg font-semibold'>Console Logs</h3>
                <div className='max-h-48 overflow-y-auto rounded-lg bg-gray-100 p-4'>
                  {consoleLogs.map((log, index) => (
                    <div
                      key={`${log.timestamp}-${index}`}
                      className={`text-sm ${
                        log.level === 'ERROR'
                          ? 'text-red-600'
                          : log.level === 'INFO'
                            ? 'text-green-600'
                            : 'text-gray-800'
                      }`}
                    >
                      {new Date(log.timestamp).toLocaleString()} -{' '}
                      {log.context ? `[${log.context}] ` : ''}
                      {log.message}
                      {log.error && (
                        <pre className='mt-1 rounded bg-gray-200 p-1 text-xs'>
                          {log.error.message}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value='track-suggestions'>
            <div className='space-y-6'>
              <TrackSuggestionsTab
                onStateChange={handleTrackSuggestionsStateChange}
              />
              <div className='flex items-center justify-end space-x-4'>
                {refreshError && (
                  <div className='text-sm text-red-500'>{refreshError}</div>
                )}
                <button
                  onClick={() => void handleTrackSuggestionsRefresh()}
                  disabled={isRefreshingSuggestions}
                  className='bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isRefreshingSuggestions ? 'Refreshing...' : 'Refresh Now'}
                </button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
