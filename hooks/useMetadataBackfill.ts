import { useEffect, useRef } from 'react'
import { useUserToken } from './useUserToken'
import { backfillRandomMissingTrack } from '@/services/game/metadataBackfill'
import { createModuleLogger } from '@/shared/utils/logger'
import { showToast } from '@/lib/toast'

const logger = createModuleLogger('useMetadataBackfill')

const BACKFILL_INTERVAL_MS = 60 * 1000 // 1 minute

export function useMetadataBackfill() {
  const { token: accessToken } = useUserToken()
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const isRunningRef = useRef(false)

  useEffect(() => {
    // Only run if we have a token (admin is logged in)
    if (!accessToken) return

    const runBackfill = async () => {
      // Prevent concurrent runs
      if (isRunningRef.current) return

      isRunningRef.current = true
      try {
        logger('INFO', 'Starting periodic metadata backfill...')
        const result = await backfillRandomMissingTrack(accessToken)

        if (result) {
          if (result.success) {
            const msg = `Backfilled: "${result.updatedTrackName}"`
            logger('INFO', msg)
            showToast(msg, 'success')
          } else {
            const msg = `Backfill Failed: ${result.error}`
            logger('WARN', msg)
            showToast(msg, 'warning')
          }
        } else {
          logger('INFO', 'Backfill: No tracks found needing update.')
        }
      } catch (error) {
        logger(
          'ERROR',
          'Backfill error',
          undefined,
          error instanceof Error ? error : undefined
        )
      } finally {
        isRunningRef.current = false
      }
    }

    // Run immediately on mount (or when token becomes available)
    void runBackfill()

    // Set up interval
    intervalRef.current = setInterval(runBackfill, BACKFILL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [accessToken])
}
