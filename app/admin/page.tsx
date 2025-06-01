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
import { useRecoverySystem } from '@/hooks/recovery/useRecoverySystem'
import { RecoveryStatus } from '@/components/ui/recovery-status'
import { HealthStatus } from '@/shared/types'
import { SpotifyApiService } from '@/services/spotifyApi'
import { PlaylistDisplay } from './components/playlist/playlist-display'
import {
  STALL_THRESHOLD,
  STALL_CHECK_INTERVAL,
  MIN_STALLS_BEFORE_RECOVERY,
  PROGRESS_TOLERANCE
} from '@/hooks/recovery/useRecoverySystem'

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

// Add type for playback state with remaining tracks
interface PlaybackStateWithRemainingTracks extends SpotifyPlaybackState {
  remainingTracks: number
  handlePlayback: (action: 'play') => Promise<void>
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
  const [isManualPause, setIsManualPause] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setIsMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [_setIsStartingPlayback, setIsStartingPlayback] = useState(false)
  const [activeTab, setActiveTab] = useState<
    'playback' | 'settings' | 'playlist'
  >('playback')
  const [uptime, setUptime] = useState(0)
  const [_currentYear, _setCurrentYear] = useState(new Date().getFullYear())
  const startingPlaybackTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastPlaybackCheckRef = useRef<number>(Date.now())
  const lastStallCheckRef = useRef<{ timestamp: number; count: number }>({
    timestamp: 0,
    count: 0
  })
  const startTimeRef = useRef<number>(Date.now())

  // Add initialization state
  const [isInitializing, setIsInitializing] = useState(true)

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
    recover,
    reset: resetRecovery,
    playbackState
  } = useRecoverySystem(
    deviceId,
    fixedPlaylistId,
    useCallback((status) => {
      setHealthStatus((prev) => ({
        ...prev,
        device: status.device
      }))
    }, [])
  )
  const { logs: consoleLogs, addLog } = useConsoleLogs()

  // Refs
  const isRefreshing = useRef<boolean>(false)
  const handlePlaybackUpdateRef = useRef<((event: Event) => void) | null>(null)
  const handlePlaybackRef = useRef<
    ((action: 'play' | 'skip') => Promise<void>) | null
  >(null)
  const sendApiRequestWithTokenRecoveryRef = useRef<
    typeof sendApiRequestWithTokenRecovery | null
  >(null)

  // Add a ref to track if we've already updated the health status
  const _hasUpdatedHealthStatus = useRef(false)

  // Add a ref to track consecutive device mismatch detections and a grace period after recovery
  const deviceMismatchCountRef = useRef(0)
  const lastRecoveryTimeRef = useRef<number>(0)

  // Update health status when device ID or fixed playlist changes
  useEffect(() => {
    if (isInitializing) {
      setHealthStatus((prev: HealthStatus) => ({
        ...prev,
        device: 'unknown'
      }))
      return
    }

    // Only update status after initialization
    if (mounted && !isInitializing) {
      const newDeviceStatus = !deviceId
        ? 'disconnected'
        : !isReady
          ? 'unresponsive'
          : 'healthy'

      setHealthStatus((prev: HealthStatus) => ({
        ...prev,
        device: newDeviceStatus
      }))
    }

    // Log the device status update
    addLog(
      'INFO',
      `[Device Status] Updated: deviceId=${deviceId}, isReady=${isReady}, status=${healthStatus.device}, timestamp=${new Date().toISOString()}`,
      'Device',
      undefined
    )
  }, [deviceId, isReady, mounted, isInitializing, addLog])

  // Define the event handler
  useEffect(() => {
    handlePlaybackUpdateRef.current = (event: Event) => {
      const state = (event as CustomEvent<PlaybackStateWithRemainingTracks>)
        .detail
      if (!state) return

      // Update playback info
      setPlaybackInfo((_prev) => ({
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
  }, [isManualPause, addLog])

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
  }, [isReady, deviceId, playbackInfo, addLog])

  const {
    state: trackSuggestionsState,
    updateState: updateTrackSuggestionsState
  } = useTrackSuggestions()
  const [isRefreshingSuggestions, setIsRefreshingSuggestions] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [_timeUntilRefresh, setTimeUntilRefresh] = useState(REFRESH_INTERVAL)
  const lastRefreshTime = useRef<number>(Date.now())

  // Remove unused refreshToken
  useSpotifyPlayerState(deviceId ?? '')

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
      addLog(
        'ERROR',
        '[API Error]',
        'API',
        error instanceof Error ? error : undefined
      )
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
    [setHealthStatus, addLog]
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
    async (_action: 'play' | 'skip'): Promise<void> => {
      if (!deviceId || !playbackInfo) return

      try {
        const spotifyApi = SpotifyApiService.getInstance()
        if (playbackInfo.isPlaying) {
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
          // Set starting playback state and start timeout
          setIsStartingPlayback(true)
          if (startingPlaybackTimeoutRef.current) {
            clearTimeout(startingPlaybackTimeoutRef.current)
          }
          startingPlaybackTimeoutRef.current = setTimeout(() => {
            setIsStartingPlayback(false)
          }, 15000) // 15 seconds

          // Clear manual pause flag when user explicitly clicks play
          setIsManualPause(false)

          // Use the improved resumePlayback method
          const result = await spotifyApi.resumePlayback()

          if (result.success) {
            // Update playback info immediately to reflect the play state
            setPlaybackInfo((prev) => ({
              ...prev!,
              isPlaying: true,
              lastProgressCheck: Date.now(),
              progressStalled: false
            }))
            setHealthStatus((prev) => ({
              ...prev,
              playback: 'playing'
            }))

            // Log the resume result
            addLog(
              'INFO',
              `[Playback] Resumed successfully: resumedFrom=${typeof result.resumedFrom === 'string' ? result.resumedFrom : JSON.stringify(result.resumedFrom)}, deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
              'Playback',
              undefined
            )
          } else {
            throw new Error('Failed to resume playback')
          }
        }
      } catch (error) {
        // Clear starting playback state on error
        setIsStartingPlayback(false)
        if (startingPlaybackTimeoutRef.current) {
          clearTimeout(startingPlaybackTimeoutRef.current)
        }

        addLog(
          'ERROR',
          '[Playback] Control failed',
          'Playback',
          error instanceof Error ? error : undefined
        )

        // Update UI state to reflect the error
        setPlaybackInfo((prev) => ({
          ...prev!,
          isPlaying: false
        }))
        setHealthStatus((prev) => ({
          ...prev,
          playback: 'error'
        }))
        setError('Failed to control playback')

        // Attempt recovery if it's a server error
        if (
          error instanceof Error &&
          (error.message.includes('Server error') ||
            error.message.includes('500'))
        ) {
          addLog(
            'WARN',
            '[Playback] Server error detected, attempting recovery...',
            'Playback',
            error instanceof Error ? error : undefined
          )
          void recover()
        }
      }
    },
    [deviceId, playbackInfo, recover, addLog]
  )

  // Update the ref when handlePlayback changes
  useEffect(() => {
    handlePlaybackRef.current = handlePlayback
  }, [handlePlayback])

  // Declare handleRefresh first
  const handleRefresh = useCallback(
    async (source: 'auto' | 'manual' = 'manual'): Promise<void> => {
      if (isRefreshing.current) {
        addLog(
          'INFO',
          `[Refresh] Skipping ${source} refresh - already refreshing`,
          'Refresh',
          undefined
        )
        return
      }

      addLog(
        'INFO',
        `[Refresh] Starting ${source} refresh`,
        'Refresh',
        undefined
      )
      isRefreshing.current = true
      setIsLoading(true)
      setError(null)

      try {
        // Use trackSuggestionsState from the hook
        if (!trackSuggestionsState) {
          addLog(
            'ERROR',
            '[Refresh] No track suggestions state available',
            'Refresh',
            undefined
          )
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
          // Check if this is the "enough tracks" message
          if (result.message === 'Enough tracks remaining') {
            addLog(
              'INFO',
              `[Refresh] ${source} refresh skipped - enough tracks remaining`,
              'Refresh',
              undefined
            )
          } else {
            throw new Error(result.message)
          }
        } else {
          addLog(
            'INFO',
            `[Refresh] ${source} refresh completed successfully - added suggested song`,
            'Refresh',
            undefined
          )
        }
      } catch (err) {
        addLog(
          'ERROR',
          `[Refresh] ${source} refresh error`,
          'Refresh',
          err instanceof Error ? err : undefined
        )
      } finally {
        setIsLoading(false)
        isRefreshing.current = false
      }
    },
    [trackSuggestionsState, addLog]
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
      addLog(
        'INFO',
        `[Spotify Player] Ready state changed: isReady=${isReady}, deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
        'Spotify Player',
        undefined
      )
    }
  }, [isReady, deviceId, addLog])

  // Add a new effect to handle device ID changes
  useEffect(() => {
    if (deviceId) {
      addLog(
        'INFO',
        `[Spotify Player] Device ID changed: deviceId=${deviceId}, isReady=${isReady}, timestamp=${new Date().toISOString()}`,
        'Spotify Player',
        undefined
      )
    }
  }, [deviceId, isReady, addLog])

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
          addLog(
            'ERROR',
            'Error initializing playback state',
            'Playback',
            error instanceof Error ? error : undefined
          )
          // Set to paused state on error
          setHealthStatus((_prev) => ({
            ..._prev,
            playback: 'paused'
          }))
        }
      }
      void initializePlaybackState()
    }
  }, [isReady, deviceId, playbackInfo, addLog])

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
        addLog(
          'INFO',
          `Track suggestions refreshed successfully: ${JSON.stringify(data.searchDetails)}`,
          'Track Suggestions',
          undefined
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
  }, [handleRefresh, addLog])

  // Move these hooks before any conditional returns
  const _handlePlaybackClick = useCallback(() => {
    void handlePlayback('play')
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
  }, [fixedPlaylistId, playlistError, isInitialFetchComplete, addLog])

  // Cleanup timeout on unmount
  useEffect(() => {
    const timeoutRef = startingPlaybackTimeoutRef.current
    return () => {
      if (timeoutRef) {
        clearTimeout(timeoutRef)
      }
    }
  }, [])

  // Update the initialization effect
  useEffect(() => {
    if (isReady && deviceId) {
      addLog(
        'INFO',
        `[Spotify Player] Initialization complete: isReady=${isReady}, deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
        'Spotify Player',
        undefined
      )
      setIsInitializing(false)
    }
  }, [isReady, deviceId, addLog])

  // Update the playback monitoring effect to respect initialization state
  useEffect(() => {
    if (!mounted || !deviceId || !playbackInfo || isInitializing) return

    const checkPlaybackHealth = async () => {
      try {
        const spotifyApi = SpotifyApiService.getInstance()
        const currentState = await spotifyApi.getPlaybackState()

        if (!currentState) {
          addLog(
            'ERROR',
            '[Playback Monitor] Failed to get playback state',
            'Playback Monitor',
            undefined
          )
          return
        }

        // Add grace period after recovery
        const now = Date.now()
        const gracePeriodMs = 3000
        if (
          lastRecoveryTimeRef.current &&
          now - lastRecoveryTimeRef.current < gracePeriodMs
        ) {
          addLog(
            'INFO',
            '[Playback Monitor] Skipping strict device checks during grace period after recovery',
            'Playback Monitor',
            undefined
          )
          return
        }

        const timeSinceLastCheck = now - lastPlaybackCheckRef.current
        lastPlaybackCheckRef.current = now

        // More sensitive stall detection
        if (
          currentState.is_playing &&
          !isManualPause &&
          Math.abs(currentState.progress_ms - playbackInfo.progress) <
            PROGRESS_TOLERANCE &&
          timeSinceLastCheck > STALL_CHECK_INTERVAL
        ) {
          const lastStallCheck = lastStallCheckRef.current
          const timeSinceLastStallCheck = now - lastStallCheck.timestamp

          // Reduce the time between stall checks
          if (timeSinceLastStallCheck > STALL_THRESHOLD) {
            lastStallCheckRef.current = {
              timestamp: now,
              count: lastStallCheck.count + 1
            }

            addLog(
              'INFO',
              `[Playback Monitor] Stall detected: count=${lastStallCheck.count + 1}, timeSinceLastStall=${timeSinceLastStallCheck}, currentProgress=${currentState.progress_ms}, lastProgress=${playbackInfo.progress}, isPlaying=${currentState.is_playing}, isManualPause=${isManualPause}, timestamp=${new Date().toISOString()}`,
              'Playback Monitor',
              undefined
            )
            // Log a warning using ConsoleLogsProvider
            addLog(
              'WARN',
              'Playback stall detected',
              'Playback Monitor',
              undefined
            )

            // Trigger recovery after fewer stalls
            if (
              lastStallCheck.count >= MIN_STALLS_BEFORE_RECOVERY - 1 &&
              !isManualPause
            ) {
              addLog(
                'WARN',
                '[Playback Monitor] Playback stall confirmed, triggering recovery',
                'Playback Monitor',
                undefined
              )
              void recover()
              lastStallCheckRef.current = { timestamp: 0, count: 0 }
            }
          }
        } else if (playbackInfo.progressStalled && !isManualPause) {
          // Reset stall state if progress has resumed
          setPlaybackInfo((prev) =>
            prev ? { ...prev, progressStalled: false } : null
          )
          lastStallCheckRef.current = { timestamp: 0, count: 0 }
        }

        // Robust device mismatch detection
        if (!currentState.device?.id) {
          deviceMismatchCountRef.current += 1
          addLog(
            'WARN',
            `[Playback Monitor] Device mismatch detected: expectedDevice=${deviceId}, currentDevice=${currentState.device.id}, count=${deviceMismatchCountRef.current}, timestamp=${new Date().toISOString()}`,
            'Playback Monitor',
            undefined
          )
          // Only trigger recovery if missing for 3+ consecutive checks
          if (
            deviceMismatchCountRef.current >= 3 &&
            !isInitializing &&
            !isManualPause
          ) {
            addLog(
              'ERROR',
              '[Playback Monitor] Device missing for 3+ checks, triggering recovery',
              'Playback Monitor',
              undefined
            )
            void recover()
            deviceMismatchCountRef.current = 0
            lastRecoveryTimeRef.current = Date.now()
          }
        } else if (
          currentState.device.id !== deviceId &&
          !isInitializing &&
          !isManualPause
        ) {
          deviceMismatchCountRef.current += 1
          addLog(
            'WARN',
            `[Playback Monitor] Device mismatch detected: expectedDevice=${deviceId}, currentDevice=${currentState.device.id}, count=${deviceMismatchCountRef.current}, timestamp=${new Date().toISOString()}`,
            'Playback Monitor',
            undefined
          )
          if (deviceMismatchCountRef.current >= 3) {
            void recover()
            deviceMismatchCountRef.current = 0
            lastRecoveryTimeRef.current = Date.now()
          }
        } else {
          deviceMismatchCountRef.current = 0 // Reset on success
        }

        // Update playback info
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
                progressStalled: false
              }
            : null
        )
      } catch (error) {
        addLog(
          'ERROR',
          `[Playback Monitor] Error checking playback health: error=${error instanceof Error ? error.message : 'Unknown error'}, errorType=${error instanceof Error ? error.name : 'Unknown'}, stack=${error instanceof Error ? error.stack : 'N/A'}, isManualPause=${isManualPause}, isInitializing=${isInitializing}, timestamp=${new Date().toISOString()}`,
          'Playback Monitor',
          error instanceof Error ? error : undefined
        )
        if (!isManualPause && !isInitializing) {
          void recover()
          lastRecoveryTimeRef.current = Date.now()
        }
      }
    }

    // Check more frequently
    const intervalId = setInterval(() => {
      void checkPlaybackHealth()
    }, STALL_CHECK_INTERVAL)

    return () => clearInterval(intervalId)
  }, [
    mounted,
    deviceId,
    playbackInfo,
    isManualPause,
    recover,
    isInitializing,
    addLog
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
      addLog(
        'INFO',
        `[Recovery] Starting manual recovery: deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        undefined
      )
      setIsLoading(true)
      resetRecovery()
      await recover()
      addLog(
        'INFO',
        `[Recovery] Recovery completed successfully: deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        undefined
      )
    } catch (error) {
      addLog(
        'ERROR',
        `[Recovery] Error during recovery: error=${error instanceof Error ? error.message : 'Unknown error'}, errorType=${error instanceof Error ? error.name : 'Unknown'}, stack=${error instanceof Error ? error.stack : 'N/A'}, deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        error instanceof Error ? error : undefined
      )
      setError(error instanceof Error ? error.message : 'Recovery failed')
    } finally {
      setIsLoading(false)
    }
  }, [recover, deviceId, fixedPlaylistId, resetRecovery, addLog])

  // Add effect to handle recovery state cleanup
  useEffect(() => {
    if (recoveryState.phase === 'success' || recoveryState.phase === 'error') {
      const cleanupTimer = setTimeout(() => {
        resetRecovery()
      }, 3000) // Reset after 3 seconds

      return () => clearTimeout(cleanupTimer)
    }
    return () => {} // Return empty cleanup function for other cases
  }, [recoveryState.phase, resetRecovery, addLog])

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

  // Update the playback button's disabled state to use null check
  const canControlPlayback = isReady && deviceId && !_setIsStartingPlayback

  const _isPlaying = playbackInfo?.isPlaying ?? false

  return (
    <div className='text-white min-h-screen bg-black p-4'>
      <SpotifyPlayer />
      <RecoveryStatus
        isRecovering={recoveryState.isRecovering}
        message={recoveryState.message}
        progress={recoveryState.progress}
        currentStep={recoveryState.currentStep}
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
                        : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.device === 'healthy'
                    ? 'Device Connected'
                    : healthStatus.device === 'unresponsive'
                      ? 'Device Unresponsive'
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
                    ? 'Playlist found'
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
                  onClick={_handlePlaybackClick}
                  disabled={
                    !canControlPlayback ||
                    isLoading ||
                    recoveryState.isRecovering
                  }
                  className={`text-white flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    _isPlaying === true
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {isLoading
                    ? 'Loading...'
                    : !isReady
                      ? 'Initializing...'
                      : _setIsStartingPlayback
                        ? 'Starting Playback...'
                        : recoveryState.isRecovering
                          ? 'Recovering...'
                          : _isPlaying === true
                            ? 'Pause'
                            : 'Play'}
                </button>
                <button
                  onClick={handleRefreshClick}
                  disabled={
                    !canControlPlayback ||
                    isLoading ||
                    isRefreshingSuggestions ||
                    recoveryState.isRecovering
                  }
                  className='text-white flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : !isReady
                      ? 'Initializing...'
                      : recoveryState.isRecovering
                        ? 'Recovering...'
                        : 'Refresh Playlist'}
                </button>
                <button
                  onClick={() => void handleForceRecovery()}
                  disabled={isLoading || recoveryState.isRecovering}
                  className='text-white flex-1 rounded-lg bg-red-600 px-4 py-2 font-medium transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : recoveryState.isRecovering
                      ? 'Recovering...'
                      : 'Force Recovery'}
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
