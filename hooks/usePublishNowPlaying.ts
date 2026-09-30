'use client'

import { useEffect, useRef } from 'react'
import { spotifyPlayerStore } from '@/hooks/spotifyPlayerStore'
import {
  publishNowPlaying,
  resetNowPlayingPublisher,
  verifyNowPlaying
} from '@/services/nowPlayingPublisher'

const VERIFY_INTERVAL_MS = 20000

/**
 * Subscribes to the Zustand player store and publishes playback state
 * changes to the Supabase now_playing table for realtime display updates.
 */
export function usePublishNowPlaying(profileId: string | null): void {
  const profileIdRef = useRef(profileId)
  profileIdRef.current = profileId

  useEffect(() => {
    if (!profileId) return

    // Publish current state immediately
    const currentState = spotifyPlayerStore.getState().playbackState
    void publishNowPlaying(profileId, currentState)

    // Subscribe to future changes
    const unsubscribe = spotifyPlayerStore.subscribe((state, prevState) => {
      if (
        state.playbackState !== prevState.playbackState &&
        profileIdRef.current
      ) {
        void publishNowPlaying(profileIdRef.current, state.playbackState)
      }
    })

    // Safety net: confirm the row still matches the player, and repair it if
    // a write was lost, so the display never stays on a previous song
    const verifyInterval = setInterval(() => {
      void verifyNowPlaying()
    }, VERIFY_INTERVAL_MS)

    return () => {
      unsubscribe()
      clearInterval(verifyInterval)
      resetNowPlayingPublisher()
    }
  }, [profileId])
}
