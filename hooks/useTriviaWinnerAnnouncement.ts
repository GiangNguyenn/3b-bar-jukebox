'use client'

import { useEffect, useRef } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { djService } from '@/services/djService'
import { getTriviaEnabled } from '@/app/[username]/admin/components/dashboard/components/trivia-game-toggle'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface AnnouncementRow {
  script_text: string
  is_active: boolean
  profile_id: string
}

/**
 * Listens for trivia winner announcements inserted into `dj_announcements`
 * by the /api/trivia/reset route and plays them via djService.
 *
 * Must be used on the admin page — the only page with an active audio context.
 */
export function useTriviaWinnerAnnouncement(
  profileId: string | null
): void {
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!profileId) return

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
          if (!row?.is_active || !row.script_text) return
          if (!getTriviaEnabled()) return

          // Fire and forget — djService guards against concurrent announcements
          void djService.announceTriviaWinner(row.script_text)
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabaseBrowser.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [profileId])
}
