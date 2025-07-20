import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { queueManager } from '@/services/queueManager'

export function usePlaylistData(username?: string) {
  const [queue, setQueue] = useState<JukeboxQueueItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        setError(null)

        const response = await fetch(`/api/playlist/${username}`)

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to fetch queue')
        }

        const data = (await response.json()) as JukeboxQueueItem[]
        setQueue(data)

        // Update queueManager with the fetched data
        queueManager.updateQueue(data)

        lastPollTimeRef.current = Date.now()
        addLog(
          'INFO',
          `Queue data fetched successfully: ${data.length} tracks`,
          'usePlaylistData'
        )
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error occurred'
        setError(errorMessage)
        addLog(
          'ERROR',
          `Failed to fetch queue: ${errorMessage}`,
          'usePlaylistData',
          err instanceof Error ? err : undefined
        )
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

    // Poll every 10 seconds as fallback
    const POLL_INTERVAL = 10000
    addLog(
      'INFO',
      `Starting API polling every ${POLL_INTERVAL}ms`,
      'usePlaylistData'
    )

    pollingIntervalRef.current = setInterval(async () => {
      // Only poll if real-time is not connected or if it's been more than 30 seconds since last update
      const timeSinceLastPoll = Date.now() - lastPollTimeRef.current
      const shouldPoll = !isRealtimeConnected || timeSinceLastPoll > 30000

      if (shouldPoll) {
        addLog(
          'INFO',
          `Polling API (realtime: ${isRealtimeConnected}, time since last: ${timeSinceLastPoll}ms)`,
          'usePlaylistData'
        )
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
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('display_name', username)
        .single<{ id: string }>()

      if (profileError || !profile) {
        addLog(
          'ERROR',
          `Failed to fetch profile for username: ${username}`,
          'usePlaylistData',
          profileError || new Error('No profile returned')
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

  // Listen for queueManager updates
  useEffect(() => {
    const checkQueueManagerUpdates = (): void => {
      const queueManagerQueue = queueManager.getQueue()
      const currentQueueIds = queue.map((item) => item.id).sort()
      const queueManagerIds = queueManagerQueue.map((item) => item.id).sort()

      // If queueManager has different data, update our state
      if (JSON.stringify(currentQueueIds) !== JSON.stringify(queueManagerIds)) {
        setQueue(queueManagerQueue)
      }
    }

    // Check for updates every second
    const interval = setInterval(checkQueueManagerUpdates, 1000)

    return () => clearInterval(interval)
  }, [queue, addLog])

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
    mutate,
    optimisticUpdate,
    isRealtimeConnected
  }
}
