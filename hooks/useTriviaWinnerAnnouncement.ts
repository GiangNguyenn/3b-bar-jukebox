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
 *
 * Tears down and re-creates the subscription when the trivia toggle changes,
 * so no Realtime channel or polling runs while trivia is disabled.
 */
export function useTriviaWinnerAnnouncement(profileId: string | null): void {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const processedIds = useRef<Set<string>>(new Set())
  const isRealtimeHealthy = useRef<boolean>(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!profileId) {
      console.warn('[WinnerAnnouncement] no profileId, skipping')
      return
    }

    const start = (): (() => void) => {
      if (!getTriviaEnabled()) {
        console.warn(
          '[WinnerAnnouncement] trivia disabled, skipping subscription setup'
        )
        return () => {}
      }

      console.warn(
        '[WinnerAnnouncement] initializing for profileId:',
        profileId
      )

      function handleAnnouncement(rowId: string, scriptText: string): void {
        // Dedup key uses rowId + scriptText since the row ID never changes (upsert on profile_id)
        const dedupKey = `${rowId}:${scriptText}`
        console.warn(
          '[WinnerAnnouncement] handleAnnouncement called — rowId:',
          rowId,
          'dedupKey:',
          dedupKey.slice(0, 80)
        )
        if (processedIds.current.has(dedupKey)) {
          console.warn(
            '[WinnerAnnouncement] SKIPPED — already processed dedupKey:',
            dedupKey.slice(0, 80)
          )
          return
        }
        processedIds.current.add(dedupKey)
        console.warn(
          '[WinnerAnnouncement] marking row as processed in DB and calling djService.announceTriviaWinner'
        )

        // Mark as processed in DB to prevent re-delivery
        void supabaseBrowser
          .from('dj_announcements')
          .update({ is_active: false })
          .eq('id', rowId)

        void djService.announceTriviaWinner(scriptText)
      }

      function startPolling(pid: string): void {
        if (pollIntervalRef.current) {
          console.warn(
            '[WinnerAnnouncement] startPolling — already polling, skipping'
          )
          return
        }
        console.warn(
          '[WinnerAnnouncement] startPolling — starting 10s poll for profileId:',
          pid
        )

        pollIntervalRef.current = setInterval(async () => {
          try {
            const { data } = await supabaseBrowser
              .from('dj_announcements')
              .select('id, script_text')
              .eq('profile_id', pid)
              .eq('is_active', true)
              .order('created_at', { ascending: true })

            console.warn(
              '[WinnerAnnouncement] poll result — rows:',
              data?.length ?? 0
            )
            if (!data?.length) return

            for (const row of data) {
              handleAnnouncement(row.id, row.script_text)
            }
          } catch (e) {
            console.warn('[WinnerAnnouncement] poll error:', e)
          }
        }, 10_000)
      }

      function stopPolling(): void {
        if (pollIntervalRef.current) {
          console.warn('[WinnerAnnouncement] stopPolling — clearing interval')
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
            console.warn(
              '[WinnerAnnouncement] Realtime event received:',
              JSON.stringify(payload)
            )
            const row = payload.new as AnnouncementRow | undefined
            if (!row?.is_active || !row.script_text || !row.id) {
              console.warn(
                '[WinnerAnnouncement] Realtime — skipping (is_active:',
                row?.is_active,
                'script_text:',
                !!row?.script_text,
                'id:',
                !!row?.id,
                ')'
              )
              return
            }
            handleAnnouncement(row.id, row.script_text)
          }
        )
        .subscribe((status) => {
          console.warn(
            '[WinnerAnnouncement] Realtime subscription status:',
            status
          )
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
        isRealtimeHealthy.current = false
      }
    }

    let cleanup = start()

    const handleToggle = (): void => {
      cleanup()
      cleanup = start()
    }
    window.addEventListener('trivia-enabled-changed', handleToggle)

    return () => {
      cleanup()
      window.removeEventListener('trivia-enabled-changed', handleToggle)
    }
  }, [profileId])
}
