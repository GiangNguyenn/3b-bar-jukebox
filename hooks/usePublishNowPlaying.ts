'use client'

import { useEffect, useRef } from 'react'
import { spotifyPlayerStore } from '@/hooks/spotifyPlayerStore'
import {
  publishNowPlaying,
  resetNowPlayingPublisher
} from '@/services/nowPlayingPublisher'

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

    return () => {
      unsubscribe()
      resetNowPlayingPublisher()
    }
  }, [profileId])
}
