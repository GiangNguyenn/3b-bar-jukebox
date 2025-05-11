/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { SpotifyPlayer } from '@/components/SpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState, TokenInfo } from '@/shared/types'
import { formatDate } from '@/lib/utils'
import { useSpotifyPlayerState } from '@/hooks/useSpotifyPlayerState'
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConsoleLogs } from '@/hooks/useConsoleLogs'
import { validateSongsBetweenRepeats } from './components/track-suggestions/validations/trackSuggestions'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import type { SpotifyPlayerInstance } from '@/types/spotify'
import { useTrackSuggestions } from './components/track-suggestions/hooks/useTrackSuggestions'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'

declare global {
  interface Window {
    refreshSpotifyPlayer: () => Promise<void>
    spotifyPlayerInstance: SpotifyPlayerInstance | null
    initializeSpotifyPlayer: () => Promise<void>
  }
}

const REFRESH_INTERVAL = 180000 // 3 minutes in milliseconds
const DEVICE_CHECK_INTERVAL = {
  good: 30000, // 30 seconds
  unstable: 15000, // 15 seconds
  poor: 10000, // 10 seconds
  unknown: 5000 // 5 seconds for initial checks
}

// Add initialization constants
const INITIALIZATION_TIMEOUT = 15000 // 15 seconds max
const INITIALIZATION_CHECK_INTERVAL = 500 // Check every 500ms

interface HealthStatus {
  device: 'healthy' | 'unresponsive' | 'disconnected' | 'unknown'
  playback: 'playing' | 'paused' | 'stopped' | 'error' | 'unknown'
  token: 'valid' | 'expired' | 'error' | 'unknown'
  connection: 'good' | 'unstable' | 'poor' | 'unknown'
  tokenExpiringSoon: boolean
  fixedPlaylist: 'found' | 'not_found' | 'error' | 'unknown'
}

interface RecoveryState {
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

interface PlaybackVerificationResult {
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

// Add error boundary for critical operations
const executeWithErrorBoundary = async <T,>(
  operation: () => Promise<T>,
  errorContext: string
): Promise<T | null> => {
  try {
    return await operation()
  } catch (error) {
    console.error(`[${errorContext}] Operation failed:`, error)
    return null
  }
}

async function verifyPlaybackResume(
  expectedContextUri: string,
  currentDeviceId: string | null,
  maxVerificationTime: number = 10000, // 10 seconds
  checkInterval: number = 1000 // 1 second
): Promise<PlaybackVerificationResult> {
  const startTime = Date.now()
  console.log('[Playback Verification] Starting verification process', {
    expectedContextUri,
    currentDeviceId,
    maxVerificationTime,
    checkInterval,
    timestamp: new Date().toISOString()
  })

  const initialState = await sendApiRequest<SpotifyPlaybackState>({
    path: 'me/player',
    method: 'GET'
  })

  console.log('[Playback Verification] Initial state:', {
    deviceId: initialState?.device?.id,
    isPlaying: initialState?.is_playing,
    progress: initialState?.progress_ms,
    context: initialState?.context?.uri,
    currentTrack: initialState?.item?.name,
    timestamp: new Date().toISOString()
  })

  const initialProgress = initialState?.progress_ms ?? 0
  let lastProgress = initialProgress
  let progressStalled = false
  let checkCount = 0
  let currentState: SpotifyPlaybackState | null = null

  while (Date.now() - startTime < maxVerificationTime) {
    checkCount++
    currentState = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })
  }

  if (!currentState) {
    throw new Error('Failed to get playback state')
  }

  const verificationResult: PlaybackVerificationResult = {
    isSuccessful: true,
    reason: 'Playback resumed successfully',
    details: {
      deviceMatch: currentState.device?.id === currentDeviceId,
      isPlaying: currentState.is_playing,
      progressAdvancing: currentState.progress_ms > lastProgress,
      contextMatch: currentState.context?.uri === expectedContextUri,
      currentTrack: currentState.item?.name,
      timestamp: Date.now(),
      verificationDuration: Date.now() - startTime
    }
  }

  return verificationResult
}

export default function AdminPage(): JSX.Element {
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [_error, setError] = useState<string | null>(null)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isManualPause, setIsManualPause] = useState(false)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    device: 'unknown',
    playback: 'unknown',
    token: 'valid',
    connection: 'unknown',
    tokenExpiringSoon: false,
    fixedPlaylist: 'unknown'
  })
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const { fixedPlaylistId, isInitialFetchComplete } = useFixedPlaylist()
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const isRefreshing = useRef<boolean>(false)
  const baseDelay = 2000 // 2 seconds
  const { logs: consoleLogs } = useConsoleLogs()
  const [uptime, setUptime] = useState(0)
  const [_currentYear, _setCurrentYear] = useState(new Date().getFullYear())
  const {
    state: trackSuggestionsState,
    updateState: updateTrackSuggestionsState
  } = useTrackSuggestions()
  const [isRefreshingSuggestions, setIsRefreshingSuggestions] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [timeUntilRefresh, setTimeUntilRefresh] = useState(REFRESH_INTERVAL)
  const lastRefreshTime = useRef<number>(Date.now())
  const [recoveryStatus, setRecoveryStatus] = useState<{
    isRecovering: boolean
    message: string
    progress: number
  }>({
    isRecovering: false,
    message: '',
    progress: 0
  })
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({
    lastSuccessfulPlayback: {
      trackUri: null,
      position: 0,
      timestamp: 0
    },
    consecutiveFailures: 0,
    lastErrorType: null
  })
  const [isInitializing, setIsInitializing] = useState(true)
  const initializationTimeout = useRef<NodeJS.Timeout | null>(null)
  const initializationCheckInterval = useRef<NodeJS.Timeout | null>(null)

  const { refreshToken } = useSpotifyPlayerState(fixedPlaylistId ?? '')

  const MAX_RECOVERY_ATTEMPTS = 5
  const RECOVERY_STEPS = useMemo(
    () => [
      { message: 'Refreshing player state...', weight: 0.2 },
      { message: 'Ensuring active device...', weight: 0.2 },
      { message: 'Attempting to reconnect...', weight: 0.3 },
      { message: 'Reinitializing player...', weight: 0.3 }
    ],
    []
  )

  // Create refs for functions
  const handlePlaybackRef = useRef<((action: 'play' | 'skip') => Promise<void>) | null>(null)
  const sendApiRequestWithTokenRecoveryRef = useRef<typeof sendApiRequestWithTokenRecovery | null>(null)

  // Define sendApiRequestWithTokenRecovery
  const sendApiRequestWithTokenRecovery = async <T,>(
    request: Parameters<typeof sendApiRequest>[0]
  ): Promise<T> => {
    try {
      return await sendApiRequest<T>(request)
    } catch (error) {
      handleApiError(error)
      throw error
    }
  }

  // Update the ref when sendApiRequestWithTokenRecovery changes
  useEffect(() => {
    sendApiRequestWithTokenRecoveryRef.current = sendApiRequestWithTokenRecovery
  }, [sendApiRequestWithTokenRecovery])

  // Define handlePlayback
  const handlePlayback = useCallback(async (action: 'play' | 'skip'): Promise<void> => {
    if (isInitializing) {
      console.log(
        '[Spotify] Skipping playback action - player still initializing'
      )
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      console.log('[Spotify] Starting playback sequence')

      // First, ensure we have a valid device ID
      if (!deviceId) {
        console.error('[Spotify] No device ID available')
        throw new Error('No device ID available')
      }

      // Get current state first
      const state = await executeWithErrorBoundary(
        async () => {
          const response = await sendApiRequestWithTokenRecoveryRef.current?.({
            path: 'me/player',
            method: 'GET'
          })
          if (!response) {
            throw new Error('Failed to get playback state')
          }
          return response as SpotifyPlaybackState
        },
        'Playback'
      )

      if (!state) {
        throw new Error('Failed to get playback state')
      }

      console.log('[Spotify] Current playback state:', {
        isPlaying: state.is_playing,
        deviceId: state.device?.id,
        currentDeviceId: deviceId,
        timestamp: Date.now()
      })

      // Ensure our device is active before proceeding
      if (!state?.device?.id || state.device.id !== deviceId) {
        console.log('[Spotify] Ensuring device is active')
        try {
          await sendApiRequest({
            path: 'me/player',
            method: 'PUT',
            body: {
              device_ids: [deviceId],
              play: false
            }
          })
          console.log('[Spotify] Device transfer successful')

          // Wait for device transfer to take effect
          await new Promise((resolve) => setTimeout(resolve, 1000))

          // Verify device is active
          const verifyState = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          if (verifyState?.device?.id !== deviceId) {
            console.error('[Spotify] Device verification failed:', {
              expected: deviceId,
              actual: verifyState?.device?.id
            })
            throw new Error('Device verification failed')
          }
        } catch (error) {
          console.error('[Spotify] Device transfer failed:', error)
          // If device transfer fails, try to refresh the player
          if (typeof window.refreshSpotifyPlayer === 'function') {
            console.log('[Spotify] Attempting to refresh player')
            await window.refreshSpotifyPlayer()
            // Wait a bit for the refresh to take effect
            await new Promise((resolve) => setTimeout(resolve, 1000))

            // Try device transfer again
            await sendApiRequest({
              path: 'me/player',
              method: 'PUT',
              body: {
                device_ids: [deviceId],
                play: false
              }
            })
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
            await sendApiRequest({
              path: `me/player/play?device_id=${deviceId}`,
              method: 'PUT',
              body: {
                context_uri: `spotify:playlist:${fixedPlaylistId}`,
                position_ms: state?.progress_ms ?? 0,
                offset: state?.item?.uri ? { uri: state.item.uri } : undefined
              },
              debounceTime: 60000 // 1 minute debounce
            })
            setHealthStatus((prev: HealthStatus) => ({
              ...prev,
              playback: 'playing'
            }))
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
      setHealthStatus((prev: HealthStatus) => ({ ...prev, playback: 'error' }))

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
      setIsLoading(false)
    }
  }, [
    isInitializing,
    deviceId,
    fixedPlaylistId,
    executeWithErrorBoundary,
    sendApiRequest,
    setHealthStatus,
    setIsLoading,
    setError,
    setIsManualPause
  ])

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
          songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats
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

  const attemptRecovery = useCallback(async (): Promise<void> => {
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      console.error(
        '[Recovery] Max attempts reached, attempting final recovery...'
      )
      setRecoveryStatus({
        isRecovering: true,
        message: 'Attempting final recovery with stored state...',
        progress: 90
      })

      // Try one last recovery with stored state
      const lastState = recoveryState.lastSuccessfulPlayback
      if (lastState && Date.now() - lastState.timestamp < 300000) {
        // Within 5 minutes
        try {
          console.log(
            '[Recovery] Attempting recovery with stored state:',
            lastState
          )
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: lastState.position,
              offset: { uri: lastState.trackUri }
            }
          })
          // If successful, reset recovery attempts
          setRecoveryAttempts(0)
          setRecoveryStatus({
            isRecovering: false,
            message: 'Recovery successful!',
            progress: 100
          })
          return
        } catch (error) {
          console.error('[Recovery] Final recovery attempt failed:', error)
        }
      }

      // If we get here, reload the page
      setRecoveryStatus({
        isRecovering: true,
        message: 'All recovery attempts failed. Reloading page...',
        progress: 100
      })
      setTimeout(() => {
        window.location.reload()
      }, 2000)
      return
    }

    try {
      setRecoveryStatus({
        isRecovering: true,
        message: 'Starting recovery process...',
        progress: 0
      })

      let currentProgress = 0
      const updateProgress = (step: number, success: boolean): void => {
        currentProgress += RECOVERY_STEPS[step].weight * 100
        setRecoveryStatus((prev) => ({
          ...prev,
          message: `${RECOVERY_STEPS[step].message} ${success ? '✓' : '✗'}`,
          progress: Math.min(currentProgress, 100)
        }))
      }

      // Step 1: Refresh player state
      if (typeof window.refreshSpotifyPlayer === 'function') {
        try {
          await window.refreshSpotifyPlayer()
          updateProgress(0, true)
        } catch (error) {
          console.error('[Recovery] Failed to refresh player state:', error)
          updateProgress(0, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'device'
          }))
        }
      }

      // Step 2: Ensure active device
      try {
        // Get current playback state
        const currentState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (!currentState?.device?.id) {
          // No active device found, try to transfer playback
          if (deviceId) {
            await sendApiRequest({
              path: 'me/player',
              method: 'PUT',
              body: {
                device_ids: [deviceId],
                play: false
              }
            })
            // Wait for transfer to take effect
            await new Promise((resolve) => setTimeout(resolve, 1000))

            // Verify transfer was successful
            const newState = await sendApiRequest<SpotifyPlaybackState>({
              path: 'me/player',
              method: 'GET'
            })

            if (newState?.device?.id === deviceId) {
              updateProgress(1, true)
            } else {
              throw new Error('Device transfer failed')
            }
          } else {
            throw new Error('No device ID available')
          }
        } else {
          updateProgress(1, true)
        }
      } catch (error) {
        console.error('[Recovery] Failed to ensure active device:', error)
        updateProgress(1, false)
        setRecoveryState((prev) => ({
          ...prev,
          consecutiveFailures: prev.consecutiveFailures + 1,
          lastErrorType: 'device'
        }))
      }

      // Step 3: Reconnect player
      if (typeof window.spotifyPlayerInstance?.connect === 'function') {
        try {
          await window.spotifyPlayerInstance.connect()
          updateProgress(2, true)
        } catch (error) {
          console.error('[Recovery] Failed to reconnect player:', error)
          updateProgress(2, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'connection'
          }))
        }
      }

      // Step 4: Reinitialize player and resume playback
      if (typeof window.initializeSpotifyPlayer === 'function') {
        try {
          // Get current playback state before reinitializing
          const currentState = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          await window.initializeSpotifyPlayer()
          updateProgress(3, true)

          // Resume playback from last position
          if (currentState?.item?.uri) {
            await sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: `spotify:playlist:${fixedPlaylistId}`,
                position_ms: currentState.progress_ms ?? 0,
                offset: { uri: currentState.item.uri }
              },
              debounceTime: 60000 // 1 minute debounce
            })
          }

          // Verify playback resumed correctly
          console.log('[Recovery] Starting playback verification')
          const verificationResult = await verifyPlaybackResume(
            `spotify:playlist:${fixedPlaylistId}`,
            deviceId
          )

          if (!verificationResult.isSuccessful) {
            console.error('[Recovery] Playback verification failed:', {
              reason: verificationResult.reason,
              details: verificationResult.details,
              timestamp: new Date().toISOString()
            })

            // Attempt retry with different strategy based on failure reason
            if (verificationResult.details?.deviceMatch === false) {
              console.log('[Recovery] Retrying device transfer')
              await sendApiRequest({
                path: 'me/player',
                method: 'PUT',
                body: {
                  device_ids: [deviceId],
                  play: false
                }
              })
            } else if (verificationResult.details?.isPlaying === false) {
              console.log('[Recovery] Retrying playback start')
              await sendApiRequest({
                path: 'me/player/play',
                method: 'PUT',
                body: {
                  context_uri: `spotify:playlist:${fixedPlaylistId}`,
                  position_ms: currentState?.progress_ms ?? 0
                }
              })
            } else if (
              verificationResult.details?.progressAdvancing === false
            ) {
              console.log('[Recovery] Retrying with next track')
              await sendApiRequest({
                path: 'me/player/next',
                method: 'POST'
              })
            }

            // Verify again after retry
            console.log('[Recovery] Starting retry verification')
            const retryVerification = await verifyPlaybackResume(
              `spotify:playlist:${fixedPlaylistId}`,
              deviceId
            )

            if (!retryVerification.isSuccessful) {
              console.error('[Recovery] Retry verification failed:', {
                reason: retryVerification.reason,
                details: retryVerification.details,
                timestamp: new Date().toISOString()
              })
              throw new Error(
                `Playback verification failed after retry: ${retryVerification.reason}`
              )
            }
          }
        } catch (error) {
          console.error('[Recovery] Failed to reinitialize player:', error)
          updateProgress(3, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'playback'
          }))
        }
      }

      // If we get here, recovery was successful
      setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
      setRecoveryAttempts(0)
      setRecoveryState((prev) => ({
        ...prev,
        consecutiveFailures: 0,
        lastErrorType: null
      }))
      setRecoveryStatus({
        isRecovering: false,
        message: 'Recovery successful!',
        progress: 100
      })

      // Clear recovery status after 3 seconds
      setTimeout(() => {
        setRecoveryStatus({
          isRecovering: false,
          message: '',
          progress: 0
        })
      }, 3000)
    } catch (error) {
      console.error('[Recovery] Failed:', error)
      setRecoveryAttempts((prev) => prev + 1)
      setRecoveryState((prev) => ({
        ...prev,
        consecutiveFailures: prev.consecutiveFailures + 1,
        lastErrorType: 'playback'
      }))

      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, recoveryAttempts)
      recoveryTimeout.current = setTimeout(() => {
        void attemptRecovery()
      }, delay)
    }
  }, [
    recoveryAttempts,
    baseDelay,
    fixedPlaylistId,
    RECOVERY_STEPS,
    recoveryState,
    deviceId
  ])

  // Move cleanup effect to be with other effects
  useEffect(() => {
    // Initial setup
    setMounted(true)

    // Cleanup function
    return () => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
      if (initializationTimeout.current) {
        clearTimeout(initializationTimeout.current)
      }
      if (initializationCheckInterval.current) {
        clearInterval(initializationCheckInterval.current)
      }
    }
  }, [])

  // Add token error detection to API requests
  const handleApiError = useCallback((error: unknown): void => {
    console.error('[API] Error:', error)
  }, [])

  // Device health check and recovery
  useEffect(() => {
    const checkDeviceHealth = async (): Promise<void> => {
      if (!deviceId) {
        setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
        void attemptRecovery()
        return
      }

      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (!state?.device?.id) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          void attemptRecovery()
          return
        }

        // If we have a device ID and the player is ready, mark as healthy
        if (isReady) {
          console.log('[Device] Player is ready, marking as healthy:', {
            deviceId,
            isReady,
            timestamp: Date.now()
          })
          setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
          setRecoveryAttempts(0)
          return
        }

        // If device IDs don't match, mark as disconnected
        if (state.device.id !== deviceId) {
          console.log('[Device] Device ID mismatch:', {
            currentId: deviceId,
            reportedId: state.device.id,
            isReady,
            timestamp: Date.now()
          })
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          void attemptRecovery()
          return
        }

        // If we have a matching device ID but player isn't ready, mark as unresponsive
        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        void attemptRecovery()
      } catch (error) {
        console.error('[Device] Health check failed:', error)
        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        void attemptRecovery()
      }
    }

    const getCheckInterval = (): number => {
      return DEVICE_CHECK_INTERVAL[healthStatus.connection]
    }

    deviceCheckInterval.current = setInterval(() => {
      void checkDeviceHealth()
    }, getCheckInterval())

    return (): void => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
    }
  }, [deviceId, healthStatus.connection, attemptRecovery, isReady])

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
      setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
    }
  }, [isReady, deviceId])

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

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const handlePlaylistChecked = useCallback(
    (event: CustomEvent<PlaylistCheckedInfo>) => {
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
    } else if (isInitialFetchComplete) {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'not_found' }))
    }
  }, [fixedPlaylistId, isInitialFetchComplete])

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

  // Add initialization check effect
  useEffect(() => {
    const checkInitialization = async () => {
      try {
        // Wait for SDK to be ready
        if (!window.Spotify) {
          await new Promise<void>((resolve) => {
            const handleSDKReady = () => {
              window.removeEventListener('spotifySDKReady', handleSDKReady)
              resolve()
            }
            window.addEventListener('spotifySDKReady', handleSDKReady)
          })
        }

        // Wait for player instance
        if (!window.spotifyPlayerInstance) {
          await new Promise<void>((resolve) => {
            const handlePlayerReady = () => {
              window.removeEventListener('playerReady', handlePlayerReady)
              resolve()
            }
            window.addEventListener('playerReady', handlePlayerReady)
          })
        }

        // Wait for device ID
        const maxWait = 10000 // 10 seconds
        const startTime = Date.now()
        while (
          !useSpotifyPlayer.getState().deviceId &&
          Date.now() - startTime < maxWait
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, INITIALIZATION_CHECK_INTERVAL)
          )
        }

        setIsInitializing(false)
      } catch (error) {
        console.error('[Admin] Initialization check failed:', error)
        setIsInitializing(false)
      }
    }

    void checkInitialization()

    // Set a timeout to prevent infinite initialization
    initializationTimeout.current = setTimeout(() => {
      setIsInitializing(false)
    }, INITIALIZATION_TIMEOUT)

    // Store the interval ID in a variable that will be captured by the cleanup function
    const intervalId = setInterval(() => {
      void checkInitialization()
    }, INITIALIZATION_CHECK_INTERVAL)
    initializationCheckInterval.current = intervalId

    return () => {
      if (initializationTimeout.current) {
        clearTimeout(initializationTimeout.current)
      }
      clearInterval(intervalId)
    }
  }, [])

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
        songsBetweenRepeats
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

  // Auto-refresh timer effect
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      const timeSinceLastRefresh = now - lastRefreshTime.current
      const remainingTime = REFRESH_INTERVAL - timeSinceLastRefresh

      setTimeUntilRefresh(remainingTime)

      if (timeSinceLastRefresh >= REFRESH_INTERVAL) {
        void handleRefresh('auto')
        lastRefreshTime.current = now
      }
    }, 1000) // Update every second

    return () => clearInterval(timer)
  }, [handleRefresh])

  // Add effect to listen for playback updates and trigger refresh when song is near end
  useEffect(() => {
    const handlePlaybackUpdate = (event: CustomEvent<PlaybackInfo>): void => {
      const { timeUntilEnd } = event.detail
      if (timeUntilEnd && timeUntilEnd <= 15000) { // 15 seconds
        console.log('[Playback] Song near end, triggering refresh:', {
          timeUntilEnd,
          currentTrack: event.detail.currentTrack,
          timestamp: new Date().toISOString()
        })

        // Get the PlaylistRefreshService instance
        const playlistRefreshService = PlaylistRefreshServiceImpl.getInstance()

        // Call the service's refreshTrackSuggestions method
        void playlistRefreshService.refreshTrackSuggestions({
          genres: trackSuggestionsState?.genres ?? [],
          yearRange: trackSuggestionsState?.yearRange ?? [1950, new Date().getFullYear()],
          popularity: trackSuggestionsState?.popularity ?? 50,
          allowExplicit: trackSuggestionsState?.allowExplicit ?? false,
          maxSongLength: trackSuggestionsState?.maxSongLength ?? 300,
          songsBetweenRepeats: trackSuggestionsState?.songsBetweenRepeats ?? 5
        }).then((result) => {
          if (result.success) {
            console.log('[Playback] Refresh triggered successfully:', {
              track: result.searchDetails?.trackDetails[0]?.name,
              timestamp: new Date().toISOString()
            })
            lastRefreshTime.current = Date.now()
          } else {
            console.error('[Playback] Refresh failed:', {
              error: result.message,
              timestamp: new Date().toISOString()
            })
          }
        })
      }
    }

    window.addEventListener('playbackUpdate', handlePlaybackUpdate as EventListener)
    return () => {
      window.removeEventListener('playbackUpdate', handlePlaybackUpdate as EventListener)
    }
  }, [trackSuggestionsState])

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

      {/* Add recovery status indicator */}
      {recoveryStatus.isRecovering && (
        <div className='fixed bottom-4 left-4 right-4 mx-auto max-w-md rounded-lg bg-gray-900/90 p-4 shadow-lg'>
          <div className='flex items-center gap-4'>
            <div className='flex-1'>
              <div className='mb-1 text-sm font-medium'>
                {recoveryStatus.message}
              </div>
              <div className='h-2 w-full rounded-full bg-gray-700'>
                <div
                  className='h-2 rounded-full bg-blue-500 transition-all duration-300'
                  style={{ width: `${recoveryStatus.progress}%` }}
                />
              </div>
            </div>
            {recoveryStatus.progress === 100 && (
              <button
                onClick={() => window.location.reload()}
                className='rounded bg-blue-600 px-3 py-1 text-sm font-medium transition-colors hover:bg-blue-700'
              >
                Reload Now
              </button>
            )}
          </div>
        </div>
      )}

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
                <div className='flex flex-1 items-center gap-2'>
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
                      </span>{' '}
                      ({formatTime(playbackInfo.progress)})
                    </span>
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
                  onClick={() => void handlePlayback('play')}
                  disabled={isLoading || !isReady}
                  className='text-white flex-1 rounded-lg bg-green-600 px-4 py-2 font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : playbackInfo?.isPlaying
                      ? 'Pause'
                      : 'Play'}
                </button>
                <button
                  onClick={() => void handlePlayback('skip')}
                  disabled={isLoading || !isReady}
                  className='text-white flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Loading...' : 'Skip'}
                </button>
                <button
                  onClick={() => void handleRefresh('manual')}
                  disabled={isLoading || !isReady}
                  className='text-white flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Loading...' : 'Refresh Playlist'}
                </button>
                <button
                  onClick={() => void refreshToken()}
                  disabled={isLoading || !isReady}
                  className='text-white flex-1 rounded-lg bg-orange-600 px-4 py-2 font-medium transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Loading...' : 'Refresh Token'}
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
