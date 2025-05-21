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
import { useRecoverySystem } from '@/hooks/useRecoverySystem'
import { RecoveryStatus } from '@/components/ui/recovery-status'
import { HealthStatus } from '@/shared/types'
import { SpotifyApiService } from '@/services/spotifyApi'
import { PlaylistDisplay } from './components/playlist/playlist-display'

declare global {
  interface Window {
    refreshSpotifyPlayer: () => Promise<void>
    spotifyPlayerInstance: SpotifyPlayerInstance | null
    initializeSpotifyPlayer: () => Promise<void>
  }
}

const REFRESH_INTERVAL = 180000 // 3 minutes in milliseconds

interface PlaybackInfo {
  isPlaying: boolean
  currentTrack: string
  progress: number
  duration_ms?: number
  timeUntilEnd?: number
  lastProgressCheck?: number
  progressStalled?: boolean
  remainingTracks: number
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

    // Wait longer for initial playback to start
    await new Promise((resolve) => setTimeout(resolve, 5000))

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
    // 2. We're within the first 15 seconds of the track (might not see progress yet) OR
    // 3. We're near the end of the track (progress might be stalled) OR
    // 4. The API reports it as playing
    const isActuallyPlaying =
      progressChanged ||
      currentProgress < 15000 ||
      (newState.item?.duration_ms &&
        newState.item.duration_ms - currentProgress < 5000) ||
      timeSinceLastCheck < maxStallTime ||
      newState.is_playing

    return {
      isActuallyPlaying,
      progress: newProgress
    }
  } catch (error) {
    console.error('[Playback Verification] Failed:', error)
    return { isActuallyPlaying: false, progress: 0 }
  }
}

// Add type for playback state with remaining tracks
interface PlaybackStateWithRemainingTracks extends SpotifyPlaybackState {
  remainingTracks: number
}

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

export default function AdminPage(): JSX.Element {
  // State declarations
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    device: 'unknown',
    playback: 'paused',
    token: 'valid',
    connection: 'unknown',
    tokenExpiringSoon: false,
    fixedPlaylist: 'unknown'
  })
  const [isManualPause, setIsManualPause] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setIsMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isStartingPlayback, setIsStartingPlayback] = useState(false)
  const [activeTab, setActiveTab] = useState<
    'playback' | 'settings' | 'playlist'
  >('playback')
  const [uptime, setUptime] = useState(0)
  const [_currentYear, _setCurrentYear] = useState(new Date().getFullYear())
  const [isDeviceCheckComplete, setIsDeviceCheckComplete] = useState(false)
  const startingPlaybackTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastPlaybackCheckRef = useRef<number>(Date.now())
  const playbackStallTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(Date.now())

  // Hooks
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const {
    fixedPlaylistId,
    error: playlistError,
    isInitialFetchComplete
  } = useFixedPlaylist()
  const {
    state: recoveryState,
    attemptRecovery,
    resumePlayback
  } = useRecoverySystem(deviceId, fixedPlaylistId, (status) =>
    setHealthStatus((_prev) => ({
      ..._prev,
      device: status.device
    }))
  )
  const { logs: consoleLogs } = useConsoleLogs()

  // Refs
  const isRefreshing = useRef<boolean>(false)
  const handlePlaybackUpdateRef = useRef<((event: Event) => void) | null>(null)
  const handlePlaybackRef = useRef<
    ((action: 'play' | 'skip') => Promise<void>) | null
  >(null)
  const sendApiRequestWithTokenRecoveryRef = useRef<
    typeof sendApiRequestWithTokenRecovery | null
  >(null)

  // Define the event handler
  useEffect(() => {
    handlePlaybackUpdateRef.current = (event: Event) => {
      const state = (event as CustomEvent<PlaybackStateWithRemainingTracks>)
        .detail
      if (!state) return

      // Update playback info
      setPlaybackInfo((prev) => ({
        isPlaying: state.is_playing ?? false,
        currentTrack: state.item?.name ?? '',
        progress: state.progress_ms ?? 0,
        duration_ms: state.item?.duration_ms ?? 0,
        timeUntilEnd: state.item?.duration_ms
          ? state.item.duration_ms - (state.progress_ms ?? 0)
          : 0,
        lastProgressCheck: Date.now(),
        progressStalled: false,
        remainingTracks: state.remainingTracks
      }))

      // Update health status based on actual playback state
      setHealthStatus((_prev) => ({
        ..._prev,
        playback: state.is_playing && !isManualPause ? 'playing' : 'paused'
      }))

      // Clear manual pause flag if playback is actually playing
      if (state.is_playing) {
        setIsManualPause(false)
      }
    }

    // Set up event listener
    const handleEvent = (event: Event): void => {
      if (handlePlaybackUpdateRef.current) {
        handlePlaybackUpdateRef.current(event)
      }
    }

    window.addEventListener('playbackUpdate', handleEvent)

    return () => {
      window.removeEventListener('playbackUpdate', handleEvent)
    }
  }, [isManualPause])

  // Add effect to force initial state to paused
  useEffect(() => {
    if (isReady && deviceId && !playbackInfo) {
      setPlaybackInfo({
        isPlaying: false,
        currentTrack: '',
        progress: 0,
        duration_ms: 0,
        timeUntilEnd: 0,
        lastProgressCheck: Date.now(),
        progressStalled: false,
        remainingTracks: 0
      })
      setHealthStatus((_prev) => ({
        ..._prev,
        playback: 'paused'
      }))
    }
  }, [isReady, deviceId, playbackInfo])

  const {
    state: trackSuggestionsState,
    updateState: updateTrackSuggestionsState
  } = useTrackSuggestions()
  const [isRefreshingSuggestions, setIsRefreshingSuggestions] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [_timeUntilRefresh, setTimeUntilRefresh] = useState(REFRESH_INTERVAL)
  const lastRefreshTime = useRef<number>(Date.now())

  const { refreshToken } = useSpotifyPlayerState(deviceId ?? '')

  // Remove initialization-related interfaces and constants
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

  const handlePlayback = useCallback(
    async (action: 'play' | 'skip'): Promise<void> => {
      if (!deviceId) {
        console.error('No device ID available')
        return
      }

      try {
        const spotifyApi = SpotifyApiService.getInstance()
        const currentState = await spotifyApi.getPlaybackState()

        console.log('[Playback Action] Current state:', {
          action,
          isPlaying: currentState.is_playing,
          trackName: currentState.item?.name,
          timestamp: new Date().toISOString()
        })

        if (action === 'skip') {
          await sendApiRequest({
            path: `me/player/next?device_id=${deviceId}`,
            method: 'POST'
          })
        } else {
          if (currentState.is_playing) {
            await sendApiRequest({
              path: `me/player/pause?device_id=${deviceId}`,
              method: 'PUT'
            })
            setPlaybackInfo((prev) => ({
              ...prev!,
              isPlaying: false
            }))
            setIsManualPause(true)
            setHealthStatus((prev) => ({
              ...prev,
              playback: 'paused'
            }))
          } else {
            // Check if the current track is playable
            if (currentState.item?.is_playable === false) {
              console.error('Current track is not playable')
              return
            }

            try {
              // Clear any existing timeout
              if (startingPlaybackTimeoutRef.current) {
                clearTimeout(startingPlaybackTimeoutRef.current)
              }

              setIsStartingPlayback(true)
              // Set a minimum 20 second timeout
              startingPlaybackTimeoutRef.current = setTimeout(() => {
                setIsStartingPlayback(false)
                startingPlaybackTimeoutRef.current = null
              }, 20000)

              await sendApiRequest({
                path: `me/player/play?device_id=${deviceId}`,
                method: 'PUT'
              })

              // Add a delay before verification to allow playback to start
              await new Promise((resolve) => setTimeout(resolve, 2000))

              // Verify playback started successfully with retries
              let isActuallyPlaying = false
              let retryCount = 0
              const maxRetries = 3

              while (!isActuallyPlaying && retryCount < maxRetries) {
                const { isActuallyPlaying: verified } =
                  await verifyPlaybackProgress(deviceId)
                isActuallyPlaying = verified

                if (!isActuallyPlaying && retryCount < maxRetries - 1) {
                  console.log(
                    `[Playback Verification] Retry ${retryCount + 1}/${maxRetries}`
                  )
                  await new Promise((resolve) => setTimeout(resolve, 2000))
                }
                retryCount++
              }

              if (!isActuallyPlaying) {
                throw new Error(
                  'Playback failed to start after multiple attempts'
                )
              }

              // Add a small delay to ensure the state is updated
              await new Promise((resolve) => setTimeout(resolve, 500))

              // Fetch the latest state
              const latestState = await spotifyApi.getPlaybackState()
              if (latestState) {
                setPlaybackInfo((prev) => ({
                  ...prev!,
                  isPlaying: true
                }))
                setIsManualPause(false)
                setHealthStatus((prev) => ({
                  ...prev,
                  playback: 'playing'
                }))

                // Dispatch the updated state
                const completeState: PlaybackStateWithRemainingTracks = {
                  ...latestState,
                  is_playing: true,
                  progress_ms: latestState.progress_ms ?? 0,
                  item: latestState.item ?? null,
                  device: latestState.device ?? null,
                  remainingTracks: 0
                }

                const event = new CustomEvent('playbackUpdate', {
                  detail: completeState
                })
                handlePlaybackUpdateRef.current?.(event)
              }
            } catch (playError) {
              if (
                playError instanceof Error &&
                playError.message.includes('No active device found')
              ) {
                console.error(
                  '[Playback Action] Device not found, triggering full recovery',
                  {
                    error: playError.message,
                    timestamp: new Date().toISOString()
                  }
                )
                void attemptRecovery() // Trigger full recovery instead of just transferring playback
              } else {
                throw playError
              }
            }
          }
        }

        // Immediately fetch and update the playback state
        const newState = await spotifyApi.getPlaybackState()
        if (newState) {
          // Add a small delay to ensure the state is updated
          await new Promise((resolve) => setTimeout(resolve, 500))

          // Fetch the state again to ensure we have the latest
          const latestState = await spotifyApi.getPlaybackState()
          if (latestState && handlePlaybackUpdateRef.current) {
            const completeState: PlaybackStateWithRemainingTracks = {
              ...latestState,
              is_playing: latestState.is_playing ?? false,
              progress_ms: latestState.progress_ms ?? 0,
              item: latestState.item ?? null,
              device: latestState.device ?? null,
              remainingTracks: 0 // Will be updated by SpotifyPlayer component
            }

            const event = new CustomEvent('playbackUpdate', {
              detail: completeState
            })
            handlePlaybackUpdateRef.current(event)
          }
        }
      } catch (error) {
        console.error('Error handling playback:', error)
        setError(error instanceof Error ? error.message : 'Unknown error')
      }
    },
    [deviceId, setPlaybackInfo, setError, setIsManualPause]
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
    setIsMounted(true)

    // Store ref values in variables
    const currentHandlePlayback = handlePlaybackRef.current
    const currentSendApiRequestWithTokenRecovery =
      sendApiRequestWithTokenRecoveryRef.current

    // Cleanup function
    return () => {
      setIsMounted(false)
      if (currentHandlePlayback) {
        handlePlaybackRef.current = null
      }
      if (currentSendApiRequestWithTokenRecovery) {
        sendApiRequestWithTokenRecoveryRef.current = null
      }
    }
  }, [])

  // Update the device status effect
  useEffect(() => {
    if (isReady && deviceId) {
      // Only set to healthy if we have both isReady and deviceId
      if (isDeviceCheckComplete) {
        setHealthStatus((_prev) => ({ ..._prev, device: 'healthy' }))
        setIsLoading(false)
      }
    } else if (!isReady || !deviceId) {
      // Set to disconnected if we don't have both isReady and deviceId
      setHealthStatus((_prev) => ({ ..._prev, device: 'disconnected' }))
    }
  }, [isReady, deviceId, isDeviceCheckComplete, isManualPause])

  // Monitor connection quality
  useEffect(() => {
    if (!mounted) return

    const updateConnectionStatus = (): void => {
      if (!navigator.onLine) {
        setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        return
      }

      // Check connection type and effective type if available
      const connection = (navigator as { connection?: NetworkInformation })
        .connection
      if (connection) {
        const { effectiveType, downlink, rtt } = connection

        // Default to 'good' for ethernet and wifi connections
        if (connection.type === 'ethernet' || connection.type === 'wifi') {
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
          setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
        } else if (effectiveType === '3g' && downlink && downlink >= 1) {
          setHealthStatus((prev) => ({ ...prev, connection: 'unstable' }))
        } else {
          setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        }
      } else {
        // If Network Information API is not available, use online status
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

  // Add effect to handle device initialization
  useEffect(() => {
    if (isReady && deviceId) {
      console.log('[Device] Player ready and device ID available:', {
        deviceId,
        isReady,
        timestamp: new Date().toISOString()
      })
      setIsDeviceCheckComplete(true)
    } else {
      setIsDeviceCheckComplete(false)
    }
  }, [isReady, deviceId])

  // Add effect to initialize playback state
  useEffect(() => {
    if (isReady && deviceId && !playbackInfo) {
      const initializePlaybackState = async () => {
        try {
          const spotifyApi = SpotifyApiService.getInstance()
          const state = await spotifyApi.getPlaybackState()
          if (state) {
            const isActuallyPlaying = state.is_playing ?? false
            setPlaybackInfo({
              isPlaying: isActuallyPlaying,
              currentTrack: state.item?.name ?? '',
              progress: state.progress_ms ?? 0,
              duration_ms: state.item?.duration_ms ?? 0,
              timeUntilEnd: state.item?.duration_ms
                ? state.item.duration_ms - (state.progress_ms ?? 0)
                : 0,
              lastProgressCheck: Date.now(),
              progressStalled: false,
              remainingTracks: 0
            })

            // Update health status based on actual playback state
            setHealthStatus((_prev) => ({
              ..._prev,
              playback: isActuallyPlaying ? 'playing' : 'paused'
            }))
          }
        } catch (error) {
          console.error('Error initializing playback state:', error)
          // Set to paused state on error
          setHealthStatus((_prev) => ({
            ..._prev,
            playback: 'paused'
          }))
        }
      }
      void initializePlaybackState()
    }
  }, [isReady, deviceId, playbackInfo])

  // Update the event listener to properly handle the Promise
  useEffect(() => {
    const handleEvent = (event: Event): void => {
      if (handlePlaybackUpdateRef.current) {
        void handlePlaybackUpdateRef.current(event)
      }
    }

    window.addEventListener('playbackUpdate', handleEvent)

    return () => {
      window.removeEventListener('playbackUpdate', handleEvent)
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

  // Add effect to update fixed playlist status
  useEffect(() => {
    if (!isInitialFetchComplete) {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'unknown' }))
      return
    }

    if (playlistError) {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'error' }))
      return
    }

    if (fixedPlaylistId) {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'found' }))
    } else {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'not_found' }))
    }
  }, [fixedPlaylistId, playlistError, isInitialFetchComplete])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (startingPlaybackTimeoutRef.current) {
        clearTimeout(startingPlaybackTimeoutRef.current)
      }
    }
  }, [])

  // Add playback monitoring effect
  useEffect(() => {
    if (!mounted || !deviceId || !playbackInfo?.isPlaying || isManualPause)
      return

    const checkPlaybackHealth = async () => {
      try {
        const spotifyApi = SpotifyApiService.getInstance()
        const currentState = await spotifyApi.getPlaybackState()

        if (!currentState) {
          console.error('[Playback Monitor] Failed to get playback state')
          return
        }

        const now = Date.now()
        const timeSinceLastCheck = now - lastPlaybackCheckRef.current
        lastPlaybackCheckRef.current = now

        // Check if playback has stalled, but only if not manually paused
        if (
          currentState.is_playing &&
          !isManualPause &&
          currentState.progress_ms === playbackInfo.progress
        ) {
          if (!playbackInfo.progressStalled) {
            console.warn(
              '[Playback Monitor] Playback appears to have stalled',
              {
                currentProgress: currentState.progress_ms,
                lastProgress: playbackInfo.progress,
                timeSinceLastCheck,
                isPlaying: currentState.is_playing,
                isManualPause,
                timestamp: new Date().toISOString()
              }
            )
            setPlaybackInfo((_prev) =>
              _prev ? { ..._prev, progressStalled: true } : null
            )

            // Set a timeout to trigger full recovery if stall persists
            if (playbackStallTimeoutRef.current) {
              clearTimeout(playbackStallTimeoutRef.current)
            }
            playbackStallTimeoutRef.current = setTimeout(() => {
              if (playbackInfo.progressStalled && !isManualPause) {
                console.error(
                  '[Playback Monitor] Playback stall persisted, triggering full recovery',
                  {
                    stallDuration: 10000,
                    currentProgress: currentState.progress_ms,
                    lastProgress: playbackInfo.progress,
                    isPlaying: currentState.is_playing,
                    isManualPause,
                    timestamp: new Date().toISOString()
                  }
                )
                // Trigger full recovery system instead of just resuming playback
                void attemptRecovery()
              }
            }, 10000) // Wait 10 seconds before triggering recovery
          }
        } else if (playbackInfo.progressStalled) {
          // Reset stall state if progress has resumed or if manually paused
          setPlaybackInfo((_prev) =>
            _prev ? { ..._prev, progressStalled: false } : null
          )
          if (playbackStallTimeoutRef.current) {
            clearTimeout(playbackStallTimeoutRef.current)
          }
        }

        // Check if device is still active
        if (currentState.device?.id !== deviceId) {
          console.error('[Playback Monitor] Device mismatch detected', {
            expectedDevice: deviceId,
            currentDevice: currentState.device?.id,
            isPlaying: currentState.is_playing,
            isManualPause,
            timestamp: new Date().toISOString()
          })
          void attemptRecovery() // Trigger full recovery for device mismatch
          return
        }

        // Check if playback state is inconsistent (but not due to manual pause)
        if (
          currentState.is_playing !== playbackInfo.isPlaying &&
          !isManualPause
        ) {
          console.error('[Playback Monitor] Playback state mismatch detected', {
            expectedState: playbackInfo.isPlaying,
            currentState: currentState.is_playing,
            isManualPause,
            timestamp: new Date().toISOString()
          })
          void attemptRecovery() // Trigger full recovery for state mismatch
          return
        }

        // Update playback info with new state
        setPlaybackInfo((prev) =>
          prev
            ? {
                ...prev,
                isPlaying: currentState.is_playing ?? false,
                currentTrack: currentState.item?.name ?? '',
                progress: currentState.progress_ms ?? 0,
                duration_ms: currentState.item?.duration_ms ?? 0,
                timeUntilEnd: currentState.item?.duration_ms
                  ? currentState.item.duration_ms -
                    (currentState.progress_ms ?? 0)
                  : 0,
                lastProgressCheck: now,
                remainingTracks: 0 // Will be updated by SpotifyPlayer component
              }
            : null
        )
      } catch (error) {
        console.error('[Playback Monitor] Error checking playback health:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: error instanceof Error ? error.name : 'Unknown',
          stack: error instanceof Error ? error.stack : undefined,
          isManualPause,
          timestamp: new Date().toISOString()
        })
        if (!isManualPause) {
          // Check if it's a device-related error
          if (
            error instanceof Error &&
            error.message.toLowerCase().includes('device')
          ) {
            console.error(
              '[Playback Monitor] Device error detected, triggering full recovery',
              {
                error: error.message,
                timestamp: new Date().toISOString()
              }
            )
            void attemptRecovery()
          } else {
            void handlePlayback('play') // Try to resume playback first for non-device errors
          }
        }
      }
    }

    // Check playback health every 5 seconds
    const intervalId = setInterval(() => {
      void checkPlaybackHealth()
    }, 5000)

    return () => {
      clearInterval(intervalId)
      if (playbackStallTimeoutRef.current) {
        clearTimeout(playbackStallTimeoutRef.current)
      }
    }
  }, [
    mounted,
    deviceId,
    playbackInfo?.isPlaying,
    playbackInfo?.progress,
    playbackInfo?.progressStalled,
    isManualPause,
    handlePlayback,
    attemptRecovery
  ])

  // Add effect to update uptime
  useEffect(() => {
    const timer = setInterval(() => {
      setUptime(Date.now() - startTimeRef.current)
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const handleForceRecovery = useCallback(async () => {
    try {
      console.log('[Force Recovery] Starting manual recovery', {
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString()
      })

      // Set loading state
      setIsLoading(true)

      // Attempt recovery
      await attemptRecovery()

      console.log('[Force Recovery] Recovery completed successfully', {
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      console.error('[Force Recovery] Error during recovery:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString()
      })
      setError(error instanceof Error ? error.message : 'Recovery failed')
    } finally {
      setIsLoading(false)
    }
  }, [attemptRecovery, deviceId, fixedPlaylistId])

  // Update the loading state check
  if (!mounted) {
    return (
      <div className='text-white min-h-screen bg-black p-4'>
        <div className='flex h-screen items-center justify-center'>
          <div className='text-center'>
            <div className='mb-4 text-lg'>Loading...</div>
            <div className='border-white mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-t-2'></div>
          </div>
        </div>
      </div>
    )
  }

  // Update the skip button's disabled state to use null check
  const isSkipDisabled =
    !playbackInfo?.isPlaying || (playbackInfo?.remainingTracks ?? 0) <= 2

  return (
    <div className='text-white min-h-screen bg-black p-4'>
      <SpotifyPlayer />
      <RecoveryStatus
        isRecovering={recoveryState.isRecovering}
        message={recoveryState.status.message}
        progress={recoveryState.status.progress}
        currentStep={recoveryState.currentStep}
        totalSteps={recoveryState.totalSteps}
      />

      <div className='mx-auto max-w-xl space-y-4'>
        <h1 className='mb-8 text-2xl font-bold'>Admin Controls</h1>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (
              value === 'playback' ||
              value === 'settings' ||
              value === 'playlist'
            ) {
              setActiveTab(value)
            }
          }}
          className='space-y-4'
        >
          <TabsList className='grid w-full grid-cols-3 bg-gray-800/50'>
            <TabsTrigger
              value='playback'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value='settings'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Track Suggestions
            </TabsTrigger>
            <TabsTrigger
              value='playlist'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Playlist
            </TabsTrigger>
          </TabsList>

          <TabsContent value='playback'>
            {error && (
              <div className='mb-4 rounded border border-red-500 bg-red-900/50 p-4 text-red-100'>
                {error}
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
                  {recoveryState.attempts > 0 &&
                    ` (Recovery ${recoveryState.attempts}/5)`}
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
                  disabled={
                    isLoading ||
                    !isReady ||
                    !isDeviceCheckComplete ||
                    isStartingPlayback
                  }
                  className='text-white flex-1 rounded-lg bg-green-600 px-4 py-2 font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : !isDeviceCheckComplete
                      ? 'Initializing...'
                      : isStartingPlayback
                        ? 'Starting Playback...'
                        : playbackInfo?.isPlaying === true
                          ? 'Pause'
                          : 'Play'}
                </button>
                <button
                  onClick={handleSkipClick}
                  disabled={
                    isLoading ||
                    !isReady ||
                    !isDeviceCheckComplete ||
                    isSkipDisabled
                  }
                  className='text-white flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : !isDeviceCheckComplete
                      ? 'Initializing...'
                      : isSkipDisabled
                        ? 'No Upcoming Tracks'
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
                  onClick={() => void handleForceRecovery()}
                  disabled={isLoading}
                  className='text-white flex-1 rounded-lg bg-red-600 px-4 py-2 font-medium transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Loading...' : 'Force Recovery'}
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

          <TabsContent value='settings'>
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

          <TabsContent value='playlist'>
            <div className='space-y-6'>
              <h2 className='text-xl font-semibold'>Playlist Management</h2>
              {fixedPlaylistId ? (
                <PlaylistDisplay playlistId={fixedPlaylistId} />
              ) : (
                <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                  <p className='text-gray-400'>No playlist selected</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
