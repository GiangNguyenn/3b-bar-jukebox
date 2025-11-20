import { createModuleLogger } from '@/shared/utils/logger'
import { categorizeNetworkError } from '@/shared/utils/networkErrorDetection'
import { queueManager } from '@/services/queueManager'
import type { JukeboxQueueItem } from '@/shared/types/queue'

const logger = createModuleLogger('QueueRecovery')

export interface QueueRecoveryResult {
  queue: JukeboxQueueItem[]
  isStale: boolean
  source: 'fresh' | 'cached' | 'empty'
}

/**
 * Attempts to recover queue data when API fetch fails
 * Falls back to cached data from queueManager if available
 */
export function recoverQueueFromCache(): QueueRecoveryResult {
  const cachedQueue = queueManager.getQueue()

  if (cachedQueue.length > 0) {
    logger(
      'WARN',
      `Queue API fetch failed - using cached queue data (${cachedQueue.length} tracks)`
    )
    return {
      queue: cachedQueue,
      isStale: true,
      source: 'cached'
    }
  }

  logger('ERROR', 'Queue API fetch failed - no cached data available')
  return {
    queue: [],
    isStale: true,
    source: 'empty'
  }
}

/**
 * Determines the error type from a fetch failure
 * Uses shared network error detection with queue-specific messaging
 */
export function categorizeQueueError(error: unknown): {
  type: 'network' | 'api' | 'unknown'
  message: string
} {
  const categorized = categorizeNetworkError(error)

  // Override unknown error message with queue-specific message
  if (categorized.type === 'unknown') {
    return {
      type: 'unknown',
      message: 'An unexpected error occurred while loading the queue.'
    }
  }

  return categorized
}

/**
 * Logs queue recovery actions for debugging
 */
export function logQueueRecovery(
  errorType: 'network' | 'api' | 'unknown',
  recoverySource: 'cached' | 'empty',
  queueSize: number
): void {
  logger(
    'WARN',
    `Queue recovery: errorType=${errorType}, source=${recoverySource}, queueSize=${queueSize}`
  )
}
