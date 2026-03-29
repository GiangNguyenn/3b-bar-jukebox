'use client'

import { useEffect, useRef } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { djService } from '@/services/djService'
import { getTriviaEnabled } from '@/app/[username]/admin/components/dashboard/components/trivia-game-toggle'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface AnnouncementRow {
  id: string
  script_text: string
  is_active: boolean
  profile_id: string
}

/**
 * Listens for trivia winner announcements inserted into `dj_announcements`
 * by the /api/trivia/reset route and plays them via djService.
 *
 * Includes Realtime health monitoring with polling fallback and deduplication.
 * Must be used on the admin page — the only page with an active audio context.
 */
export function useTriviaWinnerAnnouncement(profileId: string | null): void {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const processedIds = useRef<Set<string>>(new Set())
  const isRealtimeHealthy = useRef<boolean>(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!profileId) return

    function handleAnnouncement(rowId: string, scriptText: string): void {
      if (processedIds.current.has(rowId)) return
      processedIds.current.add(rowId)

      // Mark as processed in DB to prevent re-delivery
      void supabaseBrowser
        .from('dj_announcements')
        .update({ is_active: false })
        .eq('id', rowId)

      void djService.announceTriviaWinner(scriptText)
    }

    function startPolling(pid: string): void {
      if (pollIntervalRef.current) return // already polling

      pollIntervalRef.current = setInterval(async () => {
        try {
          const { data } = await supabaseBrowser
            .from('dj_announcements')
            .select('id, script_text')
            .eq('profile_id', pid)
            .eq('is_active', true)
            .order('created_at', { ascending: true })

          if (!data?.length) return
          if (!getTriviaEnabled()) return

          for (const row of data) {
            handleAnnouncement(row.id, row.script_text)
          }
        } catch {
          // Swallow — will retry on next interval
        }
      }, 10_000)
    }

    function stopPolling(): void {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }

    const channel = supabaseBrowser
      .channel(`trivia_winner_announcement_${profileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dj_announcements',
          filter: `profile_id=eq.${profileId}`
        },
        (payload) => {
          const row = payload.new as AnnouncementRow | undefined
          if (!row?.is_active || !row.script_text || !row.id) return
          if (!getTriviaEnabled()) return
          handleAnnouncement(row.id, row.script_text)
        }
      )
      .subscribe((status) => {
        isRealtimeHealthy.current = status === 'SUBSCRIBED'
        if (status === 'SUBSCRIBED') {
          stopPolling()
        } else {
          startPolling(profileId)
        }
      })

    channelRef.current = channel

    // Timeout: if not SUBSCRIBED within 30s, start polling
    const healthTimeout = setTimeout(() => {
      if (!isRealtimeHealthy.current) {
        startPolling(profileId)
      }
    }, 30_000)

    return () => {
      clearTimeout(healthTimeout)
      stopPolling()
      if (channelRef.current) {
        supabaseBrowser.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [profileId])
}
