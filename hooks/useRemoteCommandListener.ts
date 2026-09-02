'use client'

import { useEffect, useRef } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'

export type RemoteCommand =
  | { action: 'play' | 'pause' | 'skip' }
  | { action: 'volume'; volumePercent: number }

// Wire format for the 'command' broadcast event. Carries an id so the
// sender can match a later 'command_result' ack to this specific send —
// and, just as importantly, notice when no ack ever arrives (e.g. the
// laptop's tab is backgrounded/frozen and never processes the broadcast).
export interface RemoteCommandEnvelope {
  id: string
  command: RemoteCommand
}

// Sent back over the same channel after a command is handled, so the phone
// (which has no other way to see what happened on the laptop) can tell the
// user their tap/drag actually did something — or didn't, and why.
export interface RemoteCommandResult {
  id: string
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
    respond: (result: Omit<RemoteCommandResult, 'id' | 'action'>) => void
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
        ({ payload }: { payload: RemoteCommandEnvelope }) => {
          const respond = (
            result: Omit<RemoteCommandResult, 'id' | 'action'>
          ): void => {
            void channel.send({
              type: 'broadcast',
              event: 'command_result',
              payload: {
                id: payload.id,
                action: payload.command.action,
                ...result
              } as RemoteCommandResult
            })
          }
          onCommandRef.current(payload.command, respond)
        }
      )
      .subscribe()

    return () => {
      void supabaseBrowser.removeChannel(channel)
    }
  }, [profileId])
}
