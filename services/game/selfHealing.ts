import { enqueueLazyUpdate } from './lazyUpdateQueue'

export interface HealingAction {
  type: 'artist_profile' | 'related_artists' | 'target_artist' | 'track_details'
  entityId: string
  entityName?: string
  error: string
  timestamp: number
}

interface HealingResult {
  success: boolean
  action: HealingAction
  resolution?: string
  newValue?: unknown
}

const healingQueue: HealingAction[] = []

export function enqueueHealing(action: HealingAction): void {
  const exists = healingQueue.some(
    (a) => a.type === action.type && a.entityId === action.entityId
  )
  if (exists) return
  healingQueue.push(action)
}

export async function processHealingQueue(
  token: string,
  limit: number = 2
): Promise<{
  processed: number
  succeeded: number
  failed: number
  results: HealingResult[]
}> {
  if (healingQueue.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, results: [] }
  }
  const toProcess = healingQueue.splice(0, limit)
  const results: HealingResult[] = []
  let succeeded = 0
  let failed = 0

  for (const action of toProcess) {
    try {
      const result = await processHealingAction(action, token)
      results.push(result)
      if (result.success) succeeded++
      else failed++
    } catch (error) {
      failed++
      results.push({
        success: false,
        action,
        resolution: `Error: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  return { processed: toProcess.length, succeeded, failed, results }
}

async function processHealingAction(
  action: HealingAction,
  token: string
): Promise<HealingResult> {
  switch (action.type) {
    case 'track_details':
      return await healTrackDetails(action, token)
    default:
      return { success: false, action, resolution: 'Healing not implemented' }
  }
}

async function healTrackDetails(
  action: HealingAction,
  _token: string
): Promise<HealingResult> {
  enqueueLazyUpdate({
    type: 'track_unavailable',
    spotifyId: action.entityId,
    payload: {
      is_playable: false,
      unavailable_since: new Date().toISOString()
    }
  })
  return { success: true, action, resolution: 'Marked track as unplayable' }
}

export function getHealingQueueStatus(): {
  queueSize: number
  actions: Array<{ type: string; entityName?: string; timestamp: number }>
} {
  return {
    queueSize: healingQueue.length,
    actions: healingQueue.map((a) => ({
      type: a.type,
      entityName: a.entityName,
      timestamp: a.timestamp
    }))
  }
}

