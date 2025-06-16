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
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { validateSongsBetweenRepeats } from './components/track-suggestions/validations/trackSuggestions'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import { useTrackSuggestions } from '@/app/[username]/admin/components/track-suggestions/hooks/useTrackSuggestions'
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
import { HealthStatusSection } from './components/dashboard/health-status-section'
import { useHealthMonitor } from './hooks/useHealthMonitor'
import { usePlaylist } from '@/hooks/usePlaylist'

const REFRESH_INTERVAL = 180000 // 3 minutes in milliseconds

interface PlaybackInfo {
  isPlaying: boolean
  currentTrack: string
  progress: number
  duration_ms?: number
  timeUntilEnd?: number
  lastProgressCheck?: number
  progressStalled: boolean
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

// Add debounce utility at the top of the file
const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export default function AdminPage(): JSX.Element {
  // State declarations
  const [isLoading, setIsLoading] = useState(false)
  const [_loadingAction, setLoadingAction] = useState<string | null>(null)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [isManualPause, setIsManualPause] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setIsMounted] = useState(false)
  const [isStartingPlayback, setIsStartingPlayback] = useState(false)
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'playlist' | 'settings' | 'logs'
  >('dashboard')
  const [uptime, setUptime] = useState(0)
  const [_currentYear, _setCurrentYear] = useState(new Date().getFullYear())
  const startingPlaybackTimeoutRef = useRef<NodeJS.Timeout | null>(null)
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
  const { logs: consoleLogs, addLog } = useConsoleLogsContext()

  // Use the playlist hook
  const {
    playlist,
    error: playlistRefreshError,
    refreshPlaylist
  } = usePlaylist(fixedPlaylistId ?? '')

  // Use the track suggestions hook
  const {
    state: trackSuggestionsState,
    updateState: updateTrackSuggestionsState
  } = useTrackSuggestions()

  // Add back recovery system
  const {
    state: recoveryState,
    recover,
    reset: resetRecovery
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

  // Use the new health monitor hook
  const { healthStatus, setHealthStatus } = useHealthMonitor({
    deviceId,
    isReady,
    isManualPause,
    isInitializing,
    playbackInfo
  })

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
        device: newDeviceStatus,
        // Also update player status based on isReady
        playback: prev.playback === 'playing' && !isReady ? 'paused' : prev.playback
      }))

      // Log the device status update
      addLog(
        'INFO',
        `[Device Status] Updated: deviceId=${deviceId}, isReady=${isReady}, status=${newDeviceStatus}, timestamp=${new Date().toISOString()}`,
        'Device',
        undefined
      )
    }
  }, [deviceId, isReady, mounted, isInitializing, addLog])

  // Define the event handler
  useEffect(() => {
    handlePlaybackUpdateRef.current = (event: Event) => {
      const state = (event as CustomEvent<PlaybackStateWithRemainingTracks>)
        .detail
      if (!state) return

      // Check if the current track is a URI (starts with spotify:)
      const trackName = state.item?.name
      const isUri = trackName?.startsWith('spotify:')

      // Update playback info
      setPlaybackInfo((prev) => ({
        ...prev,
        isPlaying: state.is_playing ?? false,
        // Only update the track name if it's not a URI
        currentTrack: isUri ? (prev?.currentTrack ?? '') : (trackName ?? ''),
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

  const handlePlayPause = useCallback(async () => {
    if (!deviceId) return

    try {
      setIsLoading(true)
      setLoadingAction('playPause')
      setIsStartingPlayback(true)
      const spotifyApi = SpotifyApiService.getInstance()

      if (playbackInfo?.isPlaying === true) {
        // If currently playing, pause playback
        const result = await spotifyApi.pausePlayback(deviceId)
        if (result.success) {
          addLog(
            'INFO',
            `[Playback] Paused successfully: deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
            'Playback',
            undefined
          )
          setPlaybackInfo((prev) =>
            prev
              ? {
                  ...prev,
                  isPlaying: false
                }
              : null
          )
          setHealthStatus((prev) => ({
            ...prev,
            playback: 'paused'
          }))
          setIsManualPause(true)
        } else {
          throw new Error('Failed to pause playback')
        }
      } else {
        // If not playing, resume playback
        const result = await spotifyApi.resumePlayback()
        if (result.success) {
          addLog(
            'INFO',
            `[Playback] Resumed successfully: resumedFrom=${typeof result.resumedFrom === 'string' ? result.resumedFrom : JSON.stringify(result.resumedFrom)}, deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
            'Playback',
            undefined
          )
          setPlaybackInfo((prev) =>
            prev
              ? {
                  ...prev,
                  isPlaying: true,
                  lastProgressCheck: Date.now(),
                  progressStalled: false
                }
              : null
          )
          setHealthStatus((prev) => ({
            ...prev,
            playback: 'playing'
          }))
          setIsManualPause(false)
        } else {
          throw new Error('Failed to resume playback')
        }
      }

      // Add a small delay to allow the Spotify API to update
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Refresh the playback state
      const state = await spotifyApi.getPlaybackState()

      if (state?.device?.id === deviceId) {
        setPlaybackInfo((prev) =>
          prev
            ? {
                ...prev,
                isPlaying: state.is_playing,
                currentTrack: state.item?.uri ?? '',
                progress: state.progress_ms ?? 0,
                lastProgressCheck: Date.now(),
                progressStalled: false
              }
            : null
        )
      }
    } catch (error) {
      addLog(
        'ERROR',
        '[Playback] Control failed',
        'Playback',
        error instanceof Error ? error : undefined
      )
      setPlaybackInfo((prev) =>
        prev
          ? {
              ...prev,
              isPlaying: false
            }
          : null
      )
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
    } finally {
      setIsLoading(false)
      setLoadingAction(null)
      setIsStartingPlayback(false)
    }
  }, [
    deviceId,
    playbackInfo?.isPlaying,
    addLog,
    setPlaybackInfo,
    setHealthStatus,
    setError,
    recover,
    setIsLoading,
    setLoadingAction,
    setIsManualPause
  ])

  // Update the ref when handlePlayPause changes
  useEffect(() => {
    handlePlaybackRef.current = handlePlayPause
  }, [handlePlayPause])

  // Replace the custom refresh handler with the playlist hook's refresh
  const handleRefresh = useCallback(
    async (source: 'auto' | 'manual' = 'manual'): Promise<void> => {
      if (isRefreshing.current || !trackSuggestionsState) {
        return
      }

      isRefreshing.current = true
      setIsLoading(true)
      setError(null)

      try {
        await refreshPlaylist(trackSuggestionsState)
        addLog(
          'INFO',
          `[Refresh] ${source} refresh completed successfully`,
          'Refresh',
          undefined
        )
      } catch (err) {
        addLog(
          'ERROR',
          `[Refresh] ${source} refresh error`,
          'Refresh',
          err instanceof Error ? err : undefined
        )
        setError(err instanceof Error ? err.message : 'Refresh failed')
      } finally {
        setIsLoading(false)
        isRefreshing.current = false
      }
    },
    [trackSuggestionsState, refreshPlaylist, addLog]
  )

  // Replace the custom track suggestions refresh with the playlist service
  const handleTrackSuggestionsRefresh = useCallback(async (): Promise<void> => {
    if (!trackSuggestionsState) return

    setIsLoading(true)
    setError(null)

    try {
      const playlistRefreshService = PlaylistRefreshServiceImpl.getInstance()
      const result = await playlistRefreshService.refreshTrackSuggestions({
        genres: trackSuggestionsState.genres,
        yearRange: trackSuggestionsState.yearRange,
        popularity: trackSuggestionsState.popularity,
        allowExplicit: trackSuggestionsState.allowExplicit,
        maxSongLength: trackSuggestionsState.maxSongLength,
        songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats,
        maxOffset: trackSuggestionsState.maxOffset
      })

      if (result.success) {
        addLog(
          'INFO',
          `Track suggestions refreshed successfully: ${JSON.stringify(result.searchDetails)}`,
          'Track Suggestions',
          undefined
        )
      } else {
        throw new Error(result.message)
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'
      setError(errorMessage)
      addLog(
        'ERROR',
        `[Track Suggestions] Refresh failed: ${errorMessage}`,
        'Track Suggestions',
        error instanceof Error ? error : undefined
      )
    } finally {
      setIsLoading(false)
    }
  }, [trackSuggestionsState, addLog])

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
    void handlePlayPause()
  }, [handlePlayPause])

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

  // Update the health monitoring effect to only handle playback info updates
  useEffect(() => {
    if (!mounted || !deviceId || !playbackInfo || isInitializing) return

    const checkPlaybackState = async () => {
      try {
        const spotifyApi = SpotifyApiService.getInstance()
        const currentState = await spotifyApi.getPlaybackState()

        if (!currentState) {
          addLog(
            'ERROR',
            '[Playback] Failed to get playback state',
            'Playback',
            undefined
          )
          return
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
                lastProgressCheck: Date.now(),
                progressStalled: false
              }
            : null
        )
      } catch (error) {
        addLog(
          'ERROR',
          `[Playback] Error checking state: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'Playback',
          error instanceof Error ? error : undefined
        )
      }
    }

    const intervalId = setInterval(checkPlaybackState, 5000)
    return () => clearInterval(intervalId)
  }, [mounted, deviceId, playbackInfo, isInitializing, addLog])

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

  // Add effect to handle recovery state cleanup and log success/failure
  useEffect(() => {
    if (recoveryState.phase === 'success') {
      addLog(
        'INFO',
        `[Recovery] Recovery completed successfully: deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        undefined
      )
    } else if (recoveryState.phase === 'error') {
      addLog(
        'ERROR',
        `[Recovery] Recovery failed: deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        undefined
      )
    }
    if (recoveryState.phase === 'success' || recoveryState.phase === 'error') {
      const cleanupTimer = setTimeout(() => {
        resetRecovery()
      }, 3000) // Reset after 3 seconds

      return () => clearTimeout(cleanupTimer)
    }
    return () => {} // Return empty cleanup function for other cases
  }, [recoveryState.phase, resetRecovery, addLog, deviceId, fixedPlaylistId])

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
  const canControlPlayback = isReady && deviceId && !isStartingPlayback

  const _isPlaying = playbackInfo?.isPlaying ?? false

  const handleTabChange = (value: string) => {
    if (
      value === 'dashboard' ||
      value === 'playlist' ||
      value === 'settings' ||
      value === 'logs'
    ) {
      setActiveTab(value)
    }
  }

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
            handleTabChange(value)
          }}
          className='space-y-4'
        >
          <TabsList className='grid w-full grid-cols-3 bg-gray-800/50'>
            <TabsTrigger
              value='dashboard'
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

          <TabsContent value='dashboard'>
            {error && (
              <div className='mb-4 rounded border border-red-500 bg-red-900/50 p-4 text-red-100'>
                {error}
              </div>
            )}

            <HealthStatusSection
              healthStatus={healthStatus}
              playbackInfo={playbackInfo}
              formatTime={formatTime}
              isReady={isReady}
            />

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
                      : isStartingPlayback
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
