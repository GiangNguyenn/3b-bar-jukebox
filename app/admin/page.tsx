/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
'use client'

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type EffectCallback
} from 'react'
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
import { FALLBACK_GENRES } from '@/shared/constants/trackSuggestion'
import { validateSongsBetweenRepeats } from './components/track-suggestions/validations/trackSuggestions'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import type { SpotifyPlayerInstance } from '@/types/spotify'

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

interface HealthStatus {
  device: 'healthy' | 'unresponsive' | 'disconnected' | 'unknown'
  playback: 'playing' | 'paused' | 'stopped' | 'error' | 'unknown'
  token: 'valid' | 'expired' | 'error' | 'unknown'
  connection: 'good' | 'unstable' | 'poor' | 'unknown'
  tokenExpiringSoon: boolean
  fixedPlaylist: 'found' | 'not_found' | 'error' | 'unknown'
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

export default function AdminPage(): JSX.Element {
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [_error, setError] = useState<string | null>(null)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [activeTab, setActiveTab] = useState('dashboard')
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
  const { logs: consoleLogs, addLog } = useConsoleLogs()
  const [uptime, setUptime] = useState(0)
  const [tokenInfo, setTokenInfo] = useState<TokenInfo>({
    lastRefresh: 0,
    expiresIn: 0,
    scope: '',
    type: '',
    lastActualRefresh: 0,
    expiryTime: 0
  })
  const [_currentYear, _setCurrentYear] = useState(new Date().getFullYear())
  const [trackSuggestionsState, setTrackSuggestionsState] =
    useState<TrackSuggestionsState | null>(null)
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

  const { refreshToken } = useSpotifyPlayerState(fixedPlaylistId ?? '')

  const MAX_RECOVERY_ATTEMPTS = 5
  const RECOVERY_STEPS = [
    { message: 'Refreshing player state...', weight: 0.2 },
    { message: 'Attempting to reconnect...', weight: 0.3 },
    { message: 'Reinitializing player...', weight: 0.5 }
  ]

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
        // Get track suggestions state from localStorage
        const savedState = localStorage.getItem('track-suggestions-state')
        const trackSuggestionsState = savedState
          ? (JSON.parse(savedState) as TrackSuggestionsState)
          : {
              genres: Array.from(FALLBACK_GENRES),
              yearRange: [1950, new Date().getFullYear()],
              popularity: 50,
              allowExplicit: false,
              maxSongLength: 300,
              songsBetweenRepeats: 5
            }

        console.log(`[Refresh] Calling refresh-site endpoint with params:`, {
          genres: trackSuggestionsState.genres,
          yearRange: trackSuggestionsState.yearRange,
          popularity: trackSuggestionsState.popularity,
          allowExplicit: trackSuggestionsState.allowExplicit,
          maxSongLength: trackSuggestionsState.maxSongLength,
          songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats
        })

        const response = await fetch('/api/track-suggestions/refresh-site', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            genres: trackSuggestionsState.genres,
            yearRange: trackSuggestionsState.yearRange,
            popularity: trackSuggestionsState.popularity,
            allowExplicit: trackSuggestionsState.allowExplicit,
            maxSongLength: trackSuggestionsState.maxSongLength,
            songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats
          })
        })

        const data = (await response.json()) as RefreshResponse

        if (!response.ok) {
          console.error(
            `[Refresh] ${source} refresh failed:`,
            data.message ?? 'Unknown error'
          )
          return
        }

        // Removed the playlistRefresh event dispatch
        console.log(
          `[Refresh] ${source} refresh completed successfully - added suggested song`
        )
        addLog('INFO', 'Added suggested song successfully')
      } catch (err) {
        console.error(`[Refresh] ${source} refresh error:`, err)
        addLog(
          'ERROR',
          'Failed to add suggested song',
          undefined,
          err instanceof Error ? err : new Error(String(err))
        )
      } finally {
        setIsLoading(false)
        isRefreshing.current = false
      }
    },
    [addLog]
  )

  // Now we can safely create the ref
  const handleRefreshRef = useRef(handleRefresh)

  // Update the ref when handleRefresh changes
  useEffect(() => {
    handleRefreshRef.current = handleRefresh
  }, [handleRefresh])

  const handlePlaybackUpdate = useCallback(
    (event: CustomEvent<PlaybackInfo>) => {
      console.log('[Playback] Received update:', {
        currentTrack: event.detail.currentTrack,
        isPlaying: event.detail.isPlaying,
        progress: event.detail.progress,
        timeUntilEnd: event.detail.timeUntilEnd,
        duration_ms: event.detail.duration_ms
      })

      setPlaybackInfo(event.detail)
      setHealthStatus((prev) => ({
        ...prev,
        playback: event.detail.isPlaying ? 'playing' : 'paused'
      }))

      // Check if we're near the end of the track
      if (event.detail.timeUntilEnd) {
        console.log('[Playback] Track progress:', {
          timeUntilEnd: event.detail.timeUntilEnd,
          isNearEnd: event.detail.timeUntilEnd < 15000
        })

        if (event.detail.timeUntilEnd < 15000) {
          console.log('[Playlist] Track nearing end:', {
            currentTrack: event.detail.currentTrack,
            timeUntilEnd: event.detail.timeUntilEnd,
            progress: event.detail.progress,
            duration_ms: event.detail.duration_ms
          })

          if (!isRefreshing.current) {
            console.log('[Playlist] Triggering refresh due to track end')
            const refreshService = PlaylistRefreshServiceImpl.getInstance()
            void refreshService.refreshPlaylist()
          } else {
            console.log('[Playlist] Skipping refresh - already refreshing')
          }
        }
      } else {
        console.log('[Playback] No timeUntilEnd data available')
      }
    },
    []
  ) // No dependencies needed now

  // Listen for playback state updates from SpotifyPlayer
  useEffect(() => {
    console.log('[Playback] Setting up event listener')
    window.addEventListener(
      'playbackUpdate',
      handlePlaybackUpdate as EventListener
    )

    return () => {
      console.log('[Playback] Cleaning up event listener')
      window.removeEventListener(
        'playbackUpdate',
        handlePlaybackUpdate as EventListener
      )
    }
  }, [handlePlaybackUpdate])

  // Set mounted state
  useEffect((): void => {
    setMounted(true)
  }, [])

  const updateTokenStatus = useCallback((): void => {
    const now = Date.now()
    const minutesUntilExpiry = (tokenInfo.expiryTime - now) / (60 * 1000)

    setHealthStatus((prev) => ({
      ...prev,
      token: minutesUntilExpiry > 0 ? 'valid' : 'expired',
      tokenExpiringSoon: minutesUntilExpiry <= 15
    }))
  }, [tokenInfo.expiryTime])

  useEffect(() => {
    if (tokenInfo.expiryTime === 0) {
      void refreshToken()
    } else {
      updateTokenStatus()
    }

    const interval = setInterval(updateTokenStatus, 60000)

    const handleTokenUpdate = (event: CustomEvent<TokenInfo>): void => {
      const newTokenInfo = event.detail
      const now = Date.now()
      const minutesUntilExpiry = (newTokenInfo.expiryTime - now) / (60 * 1000)

      setHealthStatus((prev) => ({
        ...prev,
        token: minutesUntilExpiry > 0 ? 'valid' : 'expired',
        tokenExpiringSoon: minutesUntilExpiry <= 15
      }))

      setTokenInfo(newTokenInfo)
    }

    window.addEventListener('tokenUpdate', handleTokenUpdate as EventListener)

    return () => {
      clearInterval(interval)
      window.removeEventListener(
        'tokenUpdate',
        handleTokenUpdate as EventListener
      )
    }
  }, [updateTokenStatus, refreshToken, tokenInfo.expiryTime])

  const handleTokenRefresh = async (): Promise<void> => {
    try {
      await refreshToken()
      updateTokenStatus()
      addLog('INFO', 'Token refreshed successfully')
    } catch (error) {
      console.error('[Token] Refresh failed:', error)
      setHealthStatus((prev) => ({
        ...prev,
        token: 'error'
      }))
      addLog('ERROR', 'Token refresh failed')
    }
  }

  // Keep periodic status updates
  const statusEffect: EffectCallback = () => {
    if (!mounted) return

    const statusInterval = setInterval(updateTokenStatus, 60000) // Check every minute
    updateTokenStatus() // Initial status update

    return () => {
      clearInterval(statusInterval)
    }
  }

  useEffect(statusEffect, [mounted, updateTokenStatus])

  const attemptRecovery = useCallback(async (): Promise<void> => {
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      console.error('[Recovery] Max attempts reached, reloading page...')
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
        }
      }

      // Step 2: Reconnect player
      if (typeof window.spotifyPlayerInstance?.connect === 'function') {
        try {
          await window.spotifyPlayerInstance.connect()
          updateProgress(1, true)
        } catch (error) {
          console.error('[Recovery] Failed to reconnect player:', error)
          updateProgress(1, false)
        }
      }

      // Step 3: Reinitialize player and resume playback
      if (typeof window.initializeSpotifyPlayer === 'function') {
        try {
          // Get current playback state before reinitializing
          const state = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          await window.initializeSpotifyPlayer()
          updateProgress(2, true)

          // Resume playback from last position
          if (state?.item?.uri) {
            await sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: `spotify:playlist:${fixedPlaylistId}`,
                position_ms: state.progress_ms ?? 0,
                offset: { uri: state.item.uri }
              },
              debounceTime: 60000 // 1 minute debounce
            })
          }
        } catch (error) {
          console.error('[Recovery] Failed to reinitialize player:', error)
          updateProgress(2, false)
        }
      }

      // If we get here, recovery was successful
      setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
      setRecoveryAttempts(0)
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

      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, recoveryAttempts)
      recoveryTimeout.current = setTimeout(() => {
        void attemptRecovery()
      }, delay)
    }
  }, [recoveryAttempts, baseDelay, fixedPlaylistId, RECOVERY_STEPS])

  // Listen for player verification errors
  useEffect(() => {
    const handlePlayerError = (
      event: CustomEvent<{ error?: { message?: string } }>
    ): void => {
      if (
        event.detail?.error?.message?.includes('Player verification failed')
      ) {
        console.error('[Player] Verification failed')
        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        void attemptRecovery()
      }
    }

    window.addEventListener('playerError', handlePlayerError as EventListener)

    return (): void => {
      window.removeEventListener(
        'playerError',
        handlePlayerError as EventListener
      )
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
    }
  }, [attemptRecovery])

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

        if (state.device.id !== deviceId) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          void attemptRecovery()
          return
        }

        setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
        setRecoveryAttempts(0)
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
  }, [deviceId, healthStatus.connection, attemptRecovery])

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
        setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        return
      }

      // Check connection type and effective type if available
      const connection = (navigator as { connection?: NetworkInformation })
        .connection
      if (connection) {
        const { effectiveType, downlink, rtt } = connection

        if (
          effectiveType === '4g' &&
          downlink &&
          downlink > 2 &&
          rtt &&
          rtt < 100
        ) {
          setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
        } else if (
          effectiveType === '4g' ||
          (effectiveType === '3g' && downlink && downlink > 1)
        ) {
          setHealthStatus((prev) => ({ ...prev, connection: 'unstable' }))
        } else {
          setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        }
      } else {
        // Fallback to online/offline status if connection API is not available
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
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const handlePlayback = async (action: 'play' | 'skip'): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      console.log('[Spotify] Calling play API with action:', action)

      // First, transfer playback to our device
      await sendApiRequest({
        path: 'me/player',
        method: 'PUT',
        body: {
          device_ids: [deviceId],
          play: false
        }
      })

      // Wait a bit for the transfer to take effect
      await new Promise((resolve) => setTimeout(resolve, 1000))

      if (action === 'play') {
        // Get current state to ensure we resume at the right track
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        // Check if the current track is playable
        if (state?.item?.is_playable === false) {
          console.log(
            '[Spotify] Current track is not playable, skipping to next track'
          )
          await sendApiRequest({
            path: 'me/player/next',
            method: 'POST'
          })
          return
        }

        console.log('[Spotify] Starting playback with state:', {
          context_uri: `spotify:playlist:${fixedPlaylistId}`,
          position_ms: state?.progress_ms ?? 0,
          offset: state?.item?.uri ? { uri: state.item.uri } : undefined
        })

        try {
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: state?.progress_ms ?? 0,
              offset: state?.item?.uri ? { uri: state.item.uri } : undefined
            },
            debounceTime: 60000 // 1 minute debounce
          })
        } catch (playError) {
          if (
            playError instanceof Error &&
            playError.message.includes('Restriction violated')
          ) {
            console.log('[Spotify] Playback restricted, skipping to next track')
            await sendApiRequest({
              path: 'me/player/next',
              method: 'POST'
            })
            return
          }
          throw playError
        }
      } else {
        console.log('[Spotify] Skipping to next track')
        await sendApiRequest({
          path: 'me/player/next',
          method: 'POST'
        })
      }

      setHealthStatus((prev) => ({ ...prev, playback: 'playing' }))
      console.log('[Spotify] Playback action completed successfully')
    } catch (error) {
      console.error('[Spotify] Playback control failed:', error)
      setError('Failed to control playback')
      setHealthStatus((prev) => ({ ...prev, playback: 'error' }))

      // Attempt automatic recovery
      try {
        console.log('[Spotify] Attempting recovery...')
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
          // Get current state to ensure we resume at the right track
          const state = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          // Check if the current track is playable
          if (state?.item?.is_playable === false) {
            console.log(
              '[Spotify] Current track is not playable, skipping to next track'
            )
            await sendApiRequest({
              path: 'me/player/next',
              method: 'POST'
            })
            return
          }

          console.log(
            '[Spotify] Retrying playback after recovery with state:',
            {
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: state?.progress_ms ?? 0,
              offset: state?.item?.uri ? { uri: state.item.uri } : undefined
            }
          )

          try {
            await sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: `spotify:playlist:${fixedPlaylistId}`,
                position_ms: state?.progress_ms ?? 0,
                offset: state?.item?.uri ? { uri: state.item.uri } : undefined
              },
              debounceTime: 60000 // 1 minute debounce
            })
          } catch (playError) {
            if (
              playError instanceof Error &&
              playError.message.includes('Restriction violated')
            ) {
              console.log(
                '[Spotify] Playback restricted, skipping to next track'
              )
              await sendApiRequest({
                path: 'me/player/next',
                method: 'POST'
              })
              return
            }
            throw playError
          }
        } else {
          console.log('[Spotify] Retrying skip after recovery')
          await sendApiRequest({
            path: 'me/player/next',
            method: 'POST'
          })
        }

        // If we get here, recovery was successful
        setError(null)
        setHealthStatus((prev) => ({ ...prev, playback: 'playing' }))
        console.log('[Spotify] Recovery completed successfully')
      } catch (recoveryError) {
        console.error('[Spotify] Recovery failed:', recoveryError)
        // Keep the original error state if recovery fails
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleTrackSuggestionsRefresh = async (): Promise<void> => {
    if (!trackSuggestionsState) {
      addLog('ERROR', 'No track suggestions state available')
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
        addLog(
          'INFO',
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
      addLog(
        'ERROR',
        'Failed to refresh track suggestions',
        undefined,
        error instanceof Error ? error : new Error(errorMessage)
      )
    } finally {
      setIsRefreshingSuggestions(false)
    }
  }

  const handleTrackSuggestionsStateChange = (
    newState: TrackSuggestionsState
  ): void => {
    setTrackSuggestionsState(newState)
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

  // Only render content after mounting to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className='text-white min-h-screen bg-black p-4'>Loading...</div>
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
                <div className='group relative'>
                  <div className='invisible absolute left-0 top-0 z-10 rounded-lg bg-gray-800 p-2 text-xs text-gray-200 shadow-lg transition-all duration-200 group-hover:visible'>
                    <div className='whitespace-nowrap'>
                      <div>
                        Token expires: {formatDate(tokenInfo.expiryTime)}
                      </div>
                    </div>
                  </div>
                  <svg
                    className='h-4 w-4 cursor-help text-gray-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    />
                  </svg>
                </div>
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
                <div className='group relative'>
                  <div className='invisible absolute left-0 top-0 z-10 rounded-lg bg-gray-800 p-2 text-xs text-gray-200 shadow-lg transition-all duration-200 group-hover:visible'>
                    <div className='whitespace-nowrap'>
                      <div>Playlist ID: {fixedPlaylistId ?? 'Not found'}</div>
                      <div>
                        Next auto-refresh in {formatTime(timeUntilRefresh)}
                      </div>
                    </div>
                  </div>
                  <svg
                    className='h-4 w-4 cursor-help text-gray-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    />
                  </svg>
                </div>
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
                  {isLoading ? 'Loading...' : 'Play'}
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
                  onClick={() => void handleTokenRefresh()}
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
