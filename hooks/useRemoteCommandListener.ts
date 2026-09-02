'use client'

import { useEffect, useRef } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'

export type RemoteCommand =
  | { action: 'play' | 'pause' | 'skip' }
  | { action: 'volume'; volumePercent: number }

// Sent back over the same channel after a command is handled, so the phone
// (which has no other way to see what happened on the laptop) can tell the
// user their tap/drag actually did something — or didn't, and why.
export interface RemoteCommandResult {
  action: RemoteCommand['action']
  ok: boolean
  error?: string
}

export function useRemoteCommandListener({
  profileId,
  onCommand
}: {
  profileId: string | null
  onCommand: (
    cmd: RemoteCommand,
    respond: (result: Omit<RemoteCommandResult, 'action'>) => void
  ) => void
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
          const respond = (
            result: Omit<RemoteCommandResult, 'action'>
          ): void => {
            void channel.send({
              type: 'broadcast',
              event: 'command_result',
              payload: {
                action: payload.action,
                ...result
              } as RemoteCommandResult
            })
          }
          onCommandRef.current(payload, respond)
        }
      )
      .subscribe()

    return () => {
      void supabaseBrowser.removeChannel(channel)
    }
  }, [profileId])
}
