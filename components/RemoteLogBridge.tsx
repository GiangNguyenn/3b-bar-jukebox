'use client'

import { useEffect } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { remoteLogShipper } from '@/shared/utils/remoteLogShipper'
import { installDiagnostics } from '@/services/diagnostics/instrumentation'

/**
 * Turns on remote diagnostics (see docs/remote-diagnostics.md) for a
 * signed-in venue owner, on whichever page their browser is showing.
 *
 * Mounted once in the root layout for the same reason as
 * RemoteCommandBridge: the player outlives route changes, so its logs have
 * to as well. Guests never upload anything — the shipper stays disabled and
 * the instrumentation is never installed.
 */
export function RemoteLogBridge(): null {
  useEffect(() => {
    const {
      data: { subscription }
    } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      const signedIn = Boolean(session?.user)
      if (signedIn) installDiagnostics()
      remoteLogShipper.setEnabled(signedIn)
    })
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return null
}
