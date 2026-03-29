'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'

export interface LeaderboardEntry {
  session_id: string
  player_name: string
  score: number
  first_score_at: string
}

export interface UseTriviaLeaderboardOptions {
  profileId: string | null
}

export interface UseTriviaLeaderboardResult {
  entries: LeaderboardEntry[]
  isLoading: boolean
  error: string | null
}

export function useTriviaLeaderboard({
  profileId
}: UseTriviaLeaderboardOptions): UseTriviaLeaderboardResult {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [realtimeOk, setRealtimeOk] = useState(false)

  const fetchLeaderboard = useCallback(async () => {
    if (!profileId) return

    const { data, error: fetchError } = (await supabaseBrowser
      .from('trivia_scores')
      .select('session_id, player_name, score, first_score_at')
      .eq('profile_id', profileId)
      .gt('score', 0)
      .order('score', { ascending: false })
      .order('first_score_at', { ascending: true })) as {
      data: LeaderboardEntry[] | null
      error: any
    }

    if (fetchError) {
      setError(fetchError.message)
    } else if (data) {
      setEntries(data)
    }

    setIsLoading(false)
  }, [profileId])

  useEffect(() => {
    if (!profileId) {
      setIsLoading(false)
      return
    }

    void fetchLeaderboard()

    const channel = supabaseBrowser
      .channel('trivia_leaderboard_' + profileId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trivia_scores',
          filter: 'profile_id=eq.' + profileId
        },
        () => {
          // Re-fetch the whole leaderboard to maintain sort order easily
          void fetchLeaderboard()
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeOk(true)
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setRealtimeOk(false)
        }
      })

    return () => {
      supabaseBrowser.removeChannel(channel)
    }
  }, [profileId, fetchLeaderboard])

  // Polling fallback — activates when Realtime WebSocket is unavailable
  // (e.g. Firefox ETP on localhost, strict venue firewalls, Supabase outage)
  useEffect(() => {
    if (!profileId || realtimeOk) return

    const interval = setInterval(() => {
      void fetchLeaderboard()
    }, 5000)

    return () => clearInterval(interval)
  }, [profileId, realtimeOk, fetchLeaderboard])

  return { entries, isLoading, error }
}
