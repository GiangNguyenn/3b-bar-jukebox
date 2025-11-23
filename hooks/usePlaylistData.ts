import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { queueManager } from '@/services/queueManager'
import { queryWithRetry } from '@/lib/supabaseQuery'
import { fetchWithRetry } from '@/shared/utils/fetchWithRetry'
import {
  recoverQueueFromCache,
  categorizeQueueError,
  logQueueRecovery
} from '@/recovery/queueRecovery'

export function usePlaylistData(username?: string) {
  const [queue, setQueue] = useState<JukeboxQueueItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false)
  const { addLog } = useConsoleLogsContext()
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const subscriptionRef = useRef<any>(null)
  const profileIdRef = useRef<string | null>(null)
  const isInitialLoadRef = useRef(true)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastPollTimeRef = useRef<number>(0)
  const wasQueueEmptyRef = useRef<boolean>(true)

  // Fetch queue data from API
  const fetchQueue = useCallback(
    async (isBackgroundRefresh = false): Promise<void> => {
      if (!username) return

      try {
        // Only show loading state for initial load, not background refreshes
        if (isInitialLoadRef.current) {
          setIsLoading(true)
        } else if (isBackgroundRefresh) {
          setIsRefreshing(true)
        }

        // Use fetchWithRetry for automatic retry on network failures
        const response = await fetchWithRetry(
          `/api/playlist/${username}`,
          undefined,
          undefined,
          `Queue fetch for ${username}`
        )

        // Read response body once - cannot be read multiple times
        const data = (await response.json()) as
          | JukeboxQueueItem[]
          | { error?: string }

        if (!response.ok) {
          const errorMessage =
            typeof data === 'object' && data !== null && 'error' in data
              ? String(data.error)
              : 'Failed to fetch queue'
          throw new Error(errorMessage)
        }

        // Type assertion: if response.ok is true, data should be JukeboxQueueItem[]
        const queueData = data as JukeboxQueueItem[]
        setQueue(queueData)

        // Update queueManager with the fetched data
        queueManager.updateQueue(queueData)

        // Track if queue was empty
        wasQueueEmptyRef.current = queueData.length === 0

        // Clear error and stale flags on successful fetch
        setError(null)
        setIsStale(false)

        lastPollTimeRef.current = Date.now()
        addLog(
          'INFO',
          `Queue data fetched successfully: ${queueData.length} tracks`,
          'usePlaylistData'
        )
      } catch (err) {
        // Categorize the error for better user feedback
        const { type: errorType, message: errorMessage } =
          categorizeQueueError(err)

        // Attempt to recover using cached queue data
        const recovery = recoverQueueFromCache()

        // Log recovery action
        // recovery.source can be 'fresh' | 'cached' | 'empty', but logQueueRecovery expects 'cached' | 'empty'
        const recoverySource: 'cached' | 'empty' =
          recovery.source === 'fresh' ? 'empty' : recovery.source
        logQueueRecovery(errorType, recoverySource, recovery.queue.length)

        // Update state with recovery data
        if (recovery.source === 'cached') {
          // Update queue with cached data if we don't have data or if queue became empty
          // This ensures recovery works even if queue was cleared due to error
          if (wasQueueEmptyRef.current || queue.length === 0) {
            setQueue(recovery.queue)
            wasQueueEmptyRef.current = recovery.queue.length === 0
          }
          setIsStale(true)
          setError(errorMessage)
          addLog(
            'WARN',
            `Queue fetch failed, using cached data: ${errorMessage}`,
            'usePlaylistData',
            err instanceof Error ? err : undefined
          )
        } else {
          // No cached data available
          setQueue([])
          wasQueueEmptyRef.current = true
          setIsStale(true)
          setError(errorMessage)
          addLog(
            'ERROR',
            `Failed to fetch queue and no cache available: ${errorMessage}`,
            'usePlaylistData',
            err instanceof Error ? err : undefined
          )
        }
      } finally {
        if (isInitialLoadRef.current) {
          setIsLoading(false)
          isInitialLoadRef.current = false
        } else if (isBackgroundRefresh) {
          setIsRefreshing(false)
        }
      }
    },
    [username, addLog]
  )

  // Start polling
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }

    // Poll every 30 seconds as fallback - reduces API calls significantly
    const POLL_INTERVAL = 30000

    pollingIntervalRef.current = setInterval(async () => {
      // Only poll if real-time is not connected or if it's been more than 30 seconds since last update
      const timeSinceLastPoll = Date.now() - lastPollTimeRef.current
      const shouldPoll = !isRealtimeConnected || timeSinceLastPoll > 30000

      if (shouldPoll) {
        await fetchQueue(true)
      }
    }, POLL_INTERVAL)
  }, [isRealtimeConnected, fetchQueue, addLog])

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }, [])

  // Get profile ID for real-time subscriptions
  const getProfileId = useCallback(async (): Promise<string | null> => {
    if (!username) return null

    try {
      const { data: profile, error: profileError } = await queryWithRetry<{
        id: string
      }>(
        supabase
          .from('profiles')
          .select('id')
          .ilike('display_name', username)
          .single<{ id: string }>(),
        undefined,
        `Fetch profile for username: ${username}`
      )

      if (profileError ?? !profile) {
        const errorToLog =
          profileError instanceof Error
            ? profileError
            : profileError !== null && profileError !== undefined
              ? new Error(String(profileError))
              : new Error('No profile returned')
        addLog(
          'ERROR',
          `Failed to fetch profile for username: ${username}`,
          'usePlaylistData',
          errorToLog
        )
        return null
      }

      return profile.id
    } catch (err) {
      addLog(
        'ERROR',
        `Error getting profile ID: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'usePlaylistData',
        err instanceof Error ? err : undefined
      )
      return null
    }
  }, [username, supabase, addLog])

  // Set up real-time subscription
  const setupRealtimeSubscription = useCallback(
    async (profileId: string): Promise<void> => {
      if (subscriptionRef.current) {
        await supabase.removeChannel(subscriptionRef.current)
      }

      try {
        const subscription = supabase
          .channel(`jukebox_queue_changes_${profileId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'jukebox_queue',
              filter: `profile_id=eq.${profileId}`
            },
            (payload) => {
              // Refresh queue data when database changes (background refresh)
              void fetchQueue(true)
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              setIsRealtimeConnected(true)
              // Reduce polling frequency when real-time is working
              stopPolling()
              startPolling() // Restart with lower frequency
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setIsRealtimeConnected(false)
              addLog(
                'ERROR',
                `Real-time subscription failed: ${status}`,
                'usePlaylistData'
              )
              // Increase polling frequency when real-time fails
              stopPolling()
              startPolling() // Restart with higher frequency
            }
          })

        subscriptionRef.current = subscription
      } catch (err) {
        setIsRealtimeConnected(false)
        addLog(
          'ERROR',
          `Failed to set up real-time subscription: ${err instanceof Error ? err.message : 'Unknown error'}`,
          'usePlaylistData',
          err instanceof Error ? err : undefined
        )
        // Start polling as fallback
        startPolling()
      }
    },
    [
      supabase,
      fetchQueue,
      addLog,
      isRealtimeConnected,
      startPolling,
      stopPolling
    ]
  )

  // Queue manager updates are handled via real-time subscriptions and polling
  // Removed 1-second interval check to reduce unnecessary CPU usage

  // Initial setup
  useEffect(() => {
    const initialize = async (): Promise<void> => {
      if (!username) return

      // Get profile ID first
      const profileId = await getProfileId()
      if (!profileId) {
        setError('Profile not found')
        setIsLoading(false)
        return
      }

      profileIdRef.current = profileId

      // Fetch initial data
      await fetchQueue()

      // Set up real-time subscription
      await setupRealtimeSubscription(profileId)

      // Start polling as backup
      startPolling()
    }

    void initialize()

    // Cleanup on unmount or username change
    return () => {
      if (subscriptionRef.current) {
        void supabase.removeChannel(subscriptionRef.current)
        subscriptionRef.current = null
      }
      stopPolling()
    }
  }, [
    username,
    getProfileId,
    fetchQueue,
    setupRealtimeSubscription,
    startPolling,
    stopPolling,
    supabase
  ])

  // Optimistic update function
  const optimisticUpdate = useCallback(
    (updater: (currentQueue: JukeboxQueueItem[]) => JukeboxQueueItem[]) => {
      setQueue((prevQueue) => {
        const newQueue = updater(prevQueue)
        // Also update queueManager
        queueManager.updateQueue(newQueue)
        return newQueue
      })
    },
    []
  )

  // Manual refresh function
  const mutate = useCallback(async (): Promise<void> => {
    await fetchQueue(true) // Background refresh
  }, [fetchQueue])

  return {
    data: queue,
    isLoading,
    isRefreshing,
    error,
    isStale,
    mutate,
    optimisticUpdate,
    isRealtimeConnected
  }
}
