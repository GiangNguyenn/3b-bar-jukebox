'use client'

import { useEffect, useRef } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'

export type RemoteCommand =
  | { action: 'play' | 'pause' | 'skip' }
  | { action: 'volume'; volumePercent: number }

export function useRemoteCommandListener({
  profileId,
  onCommand
}: {
  profileId: string | null
  onCommand: (cmd: RemoteCommand) => void
}): void {
  // Keep a stable ref so the channel subscription never needs to re-run when
  // the callback changes (e.g. because isActuallyPlaying flipped).
  const onCommandRef = useRef(onCommand)
  useEffect(() => {
    onCommandRef.current = onCommand
  })

  useEffect(() => {
    if (!profileId) return

    const channel = supabaseBrowser
      .channel(`remote_commands_${profileId}`)
      .on(
        'broadcast',
        { event: 'command' },
        ({ payload }: { payload: RemoteCommand }) => {
          onCommandRef.current(payload)
        }
      )
      .subscribe()

    return () => {
      void supabaseBrowser.removeChannel(channel)
    }
  }, [profileId])
}
