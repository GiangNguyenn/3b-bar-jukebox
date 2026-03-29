'use client'

import { useEffect, useRef } from 'react'
import { spotifyPlayerStore } from '@/hooks/spotifyPlayerStore'
import { getTriviaEnabled } from '@/app/[username]/admin/components/dashboard/components/trivia-game-toggle'

/**
 * Pre-generates the trivia question for the currently playing track by
 * calling POST /api/trivia as soon as a track change is detected on the
 * admin page. Because the API caches questions (7-day upsert), players
 * on the game page will get an instant cache hit instead of waiting for
 * the AI to generate a response.
 *
 * Must run on the admin page — it uses the Spotify player store which is
 * only populated there.
 */
export function useTriviaQuestionPrefetch(profileId: string | null): void {
  const lastPrefetchedTrackIdRef = useRef<string | null>(null)
  const isFetchingRef = useRef(false)

  useEffect(() => {
    if (!profileId) return

    const prefetch = (
      trackId: string,
      trackName: string,
      artistName: string,
      albumName: string
    ) => {
      if (!getTriviaEnabled()) return
      if (trackId === lastPrefetchedTrackIdRef.current) return
      if (isFetchingRef.current) return

      lastPrefetchedTrackIdRef.current = trackId
      isFetchingRef.current = true

      console.log(
        `[useTriviaQuestionPrefetch] pre-generating question for "${trackName}" by ${artistName}`
      )

      fetch('/api/trivia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profileId,
          spotify_track_id: trackId,
          track_name: trackName,
          artist_name: artistName,
          album_name: albumName
        })
      })
        .then((res) => {
          if (!res.ok) {
            console.warn(
              '[useTriviaQuestionPrefetch] prefetch failed:',
              res.status
            )
          } else {
            console.log(
              '[useTriviaQuestionPrefetch] question cached successfully'
            )
          }
        })
        .catch((e) =>
          console.warn('[useTriviaQuestionPrefetch] prefetch error:', e)
        )
        .finally(() => {
          isFetchingRef.current = false
        })
    }

    // Prefetch for the current track immediately on mount
    const currentState = spotifyPlayerStore.getState().playbackState
    const item = currentState?.item
    if (item?.id) {
      prefetch(
        item.id,
        item.name,
        item.artists[0]?.name ?? 'Unknown',
        item.album.name ?? 'Unknown'
      )
    }

    // Subscribe to future track changes
    const unsubscribe = spotifyPlayerStore.subscribe((state, prevState) => {
      const newItem = state.playbackState?.item
      const prevItem = prevState.playbackState?.item
      if (newItem?.id && newItem.id !== prevItem?.id) {
        prefetch(
          newItem.id,
          newItem.name,
          newItem.artists[0]?.name ?? 'Unknown',
          newItem.album.name ?? 'Unknown'
        )
      }
    })

    return () => unsubscribe()
  }, [profileId])
}
