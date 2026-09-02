'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { usePlaybackControls } from '@/app/[username]/admin/hooks/usePlaybackControls'
import {
  useRemoteCommandListener,
  type RemoteCommand
} from '@/hooks/useRemoteCommandListener'
import { sendApiRequest, describeApiFailure } from '@/shared/api'
import { showToast } from '@/lib/toast'

/**
 * Keeps the /admin/remote command channel alive no matter which page is on
 * screen on the jukebox laptop.
 *
 * This used to live inside the admin page component, which meant the
 * listener (and its underlying realtime channel) got torn down the moment
 * that page unmounted — e.g. navigating client-side to /display, a
 * perfectly normal thing to leave running on the venue's screen. The
 * Spotify player/device itself already survives route changes as a
 * module-level singleton (see playerLifecycleService /
 * useAdminSpotifyPlayerHook's "never destroy" mode); mounting this once in
 * the root layout gives the remote listener the same treatment instead of
 * tying it to whichever page happens to be showing.
 */
export function RemoteCommandBridge(): null {
  // Track the signed-in owner's id directly (not the page's [username]
  // param, which may not even exist on the current route) so this follows
  // whoever is actually logged in in this browser, wherever they navigate.
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void supabaseBrowser.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setUserId(user?.id ?? null)
    })
    const {
      data: { subscription }
    } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const { deviceId, setVolume } = useSpotifyPlayerStore()
  const { handlePlayPause, handleSkip } = usePlaybackControls()

  const handleRemoteCommand = useCallback(
    (
      cmd: RemoteCommand,
      respond: (result: { ok: boolean; error?: string }) => void
    ) => {
      // Every action needs a live Spotify device — check once up front
      // rather than duplicating the guard per branch.
      if (!deviceId) {
        respond({ ok: false, error: 'No player device connected.' })
        return
      }

      if (cmd.action === 'play' || cmd.action === 'pause') {
        void handlePlayPause(cmd.action)
        respond({ ok: true })
      } else if (cmd.action === 'skip') {
        void handleSkip()
        respond({ ok: true })
      } else if (cmd.action === 'volume') {
        const clamped = Math.max(
          0,
          Math.min(100, Math.round(cmd.volumePercent))
        )
        setVolume(clamped)
        void sendApiRequest({
          path: `me/player/volume?volume_percent=${clamped}&device_id=${deviceId}`,
          method: 'PUT'
        })
          .then(() => respond({ ok: true }))
          .catch((error) => {
            const message = describeApiFailure(
              error,
              'Failed to set volume from remote. Please try again.'
            )
            respond({ ok: false, error: message })
            showToast(message, 'warning')
          })
      }
    },
    [deviceId, handlePlayPause, handleSkip, setVolume]
  )

  useRemoteCommandListener({
    profileId: userId,
    onCommand: handleRemoteCommand
  })

  return null
}
