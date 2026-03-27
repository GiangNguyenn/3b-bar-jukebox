'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

interface NowPlayingRow {
  profile_id: string
  spotify_track_id: string | null
  track_name: string | null
  artist_name: string | null
  album_name: string | null
  album_art_url: string | null
  duration_ms: number | null
  is_playing: boolean
  progress_ms: number | null
  updated_at: string
}

interface UseNowPlayingRealtimeOptions {
  profileId: string | null
  /** Fallback polling interval in ms. Defaults to 30s. */
  fallbackInterval?: number
}

/**
 * Transforms a now_playing row into the SpotifyPlaybackState shape
 * that the display page already expects.
 */
function rowToPlaybackState(row: NowPlayingRow): SpotifyPlaybackState | null {
  if (!row.spotify_track_id || !row.track_name) return null

  return {
    item: {
      id: row.spotify_track_id,
      name: row.track_name,
      uri: `spotify:track:${row.spotify_track_id}`,
      duration_ms: row.duration_ms ?? 0,
      artists: [{ name: row.artist_name ?? '' }],
      album: {
        name: row.album_name ?? '',
        images: row.album_art_url ? [{ url: row.album_art_url }] : []
      }
    },
    is_playing: row.is_playing,
    progress_ms: row.progress_ms ?? 0,
    timestamp: new Date(row.updated_at).getTime(),
    context: { uri: '' },
    device: {
      id: '',
      is_active: true,
      is_private_session: false,
      is_restricted: false,
      name: 'Jukebox Player',
      type: 'Computer',
      volume_percent: 50
    }
  }
}

export function useNowPlayingRealtime({
  profileId,
  fallbackInterval = 30000
}: UseNowPlayingRealtimeOptions) {
  const [data, setData] = useState<SpotifyPlaybackState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchFromTable = useCallback(async () => {
    if (!profileId) return

    const { data: row, error: fetchError } = await supabaseBrowser
      .from('now_playing')
      .select('*')
      .eq('profile_id', profileId)
      .single<NowPlayingRow>()

    if (fetchError) {
      // No row yet is not an error — just means nothing is playing
      if (fetchError.code === 'PGRST116') {
        setData(null)
      } else {
        setError(fetchError.message)
      }
    } else if (row) {
      setData(rowToPlaybackState(row))
    } else {
      setData(null)
    }

    setIsLoading(false)
  }, [profileId])

  // Initial fetch + realtime subscription
  useEffect(() => {
    if (!profileId) {
      // If we don't have a profileId, we can't fetch. 
      // Components should use useProfileId's isLoading to handle the 'waiting for profile' state.
      // We set false here so we don't block indefinitely if no profile ever comes.
      setIsLoading(false)
      return
    }

    // Initial fetch
    void fetchFromTable()

    // Subscribe to realtime changes
    const channel = supabaseBrowser
      .channel(`now_playing_${profileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'now_playing',
          filter: `profile_id=eq.${profileId}`
        },
        (payload) => {
          const row = payload.new as NowPlayingRow | undefined
          if (row) {
            setData(rowToPlaybackState(row))
          }
        }
      )
      .subscribe((status) => {
        console.warn(`[useNowPlayingRealtime] subscription status: ${status}`)
      })

    channelRef.current = channel

    // Fallback polling (safety net if realtime drops)
    intervalRef.current = setInterval(() => {
      void fetchFromTable()
    }, fallbackInterval)

    return () => {
      if (channelRef.current) {
        supabaseBrowser.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [profileId, fallbackInterval, fetchFromTable])

  return { data, isLoading, error }
}
