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
  //
  // onAuthStateChange fires once immediately with the current (locally
  // cached) session right after subscribing, so this alone gives us the
  // initial value too — no need for a separate auth.getUser() round trip
  // on every single page load site-wide, on top of whatever auth check
  // that page already does.
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const {
      data: { subscription }
    } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // usePlaybackControls' handleSkip looks up live playback state by
  // username, and that lookup trusts the string with no ownership check
  // (see /api/playback's GET handler). Resolve *our own* username from the
  // authenticated id rather than letting the hook fall back to whichever
  // page's [username] the browser happens to be showing — otherwise a
  // remote command arriving while this tab is idling on a different
  // venue's public page could read (and act on) that venue's data instead
  // of ours.
  const [username, setUsername] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setUsername(null)
      return
    }
    let cancelled = false
    void supabaseBrowser
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!cancelled) setUsername(data?.display_name ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const { deviceId, setVolume } = useSpotifyPlayerStore()
  const { handlePlayPause, handleSkip } = usePlaybackControls({
    username: username ?? undefined
  })

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
