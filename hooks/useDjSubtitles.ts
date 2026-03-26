'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'
import type { RealtimeChannel } from '@supabase/supabase-js'

const SUBTITLE_TIMEOUT_MS = 30_000

interface UseDjSubtitlesOptions {
  profileId: string | null
}

interface UseDjSubtitlesResult {
  subtitleText: string | null
  isVisible: boolean
}

interface AnnouncementPayload {
  script_text: string
  is_active: boolean
  profile_id: string
}

/**
 * Derives subtitle visibility state from a realtime announcement payload.
 * Exported for property-based testing.
 */
export function deriveSubtitleState(payload: AnnouncementPayload): {
  subtitleText: string | null
  isVisible: boolean
} {
  if (payload.is_active) {
    return { subtitleText: payload.script_text, isVisible: true }
  }
  return { subtitleText: null, isVisible: false }
}

export function useDjSubtitles(
  options: UseDjSubtitlesOptions
): UseDjSubtitlesResult {
  const { profileId } = options
  const [subtitleText, setSubtitleText] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  const clearTimeout_ = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const startTimeout = useCallback(() => {
    clearTimeout_()
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false)
    }, SUBTITLE_TIMEOUT_MS)
  }, [clearTimeout_])

  useEffect(() => {
    if (!profileId) {
      console.warn('[useDjSubtitles] no profileId, skipping subscription')
      return
    }

    console.warn(`[useDjSubtitles] subscribing to dj_announcements for profileId=${profileId}`)

    const channel = supabaseBrowser
      .channel(`dj_announcements_${profileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dj_announcements',
          filter: `profile_id=eq.${profileId}`
        },
        (payload) => {
          console.warn('[useDjSubtitles] realtime payload received:', JSON.stringify(payload))
          const row = payload.new as AnnouncementPayload | undefined
          if (!row) {
            console.warn('[useDjSubtitles] no row in payload.new')
            return
          }

          const state = deriveSubtitleState(row)
          console.warn(`[useDjSubtitles] derived state: isVisible=${state.isVisible}, text="${state.subtitleText}"`)
          setSubtitleText(state.subtitleText)
          setIsVisible(state.isVisible)

          if (state.isVisible) {
            startTimeout()
          } else {
            clearTimeout_()
          }
        }
      )
      .subscribe((status) => {
        console.warn(`[useDjSubtitles] subscription status: ${status}`)
      })

    channelRef.current = channel

    return () => {
      clearTimeout_()
      if (channelRef.current) {
        supabaseBrowser.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [profileId, startTimeout, clearTimeout_])

  return { subtitleText, isVisible }
}
