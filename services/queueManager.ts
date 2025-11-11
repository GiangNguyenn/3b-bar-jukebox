import { JukeboxQueueItem } from '@/shared/types/queue'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('QueueManager')

class QueueManager {
  private queue: JukeboxQueueItem[] = []
  private static instance: QueueManager

  private constructor() {}

  public static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager()
    }
    return QueueManager.instance
  }

  public updateQueue(newQueue: JukeboxQueueItem[]): void {
    this.queue = newQueue
  }

  public getNextTrack(): JukeboxQueueItem | undefined {
    // queue[0] is the highest priority next track to play (ordered by votes DESC, queued_at ASC)
    return this.queue.length > 0 ? this.queue[0] : undefined
  }

  public getTrackAfterNext(): JukeboxQueueItem | undefined {
    // Returns the track after the next one (queue[1])
    // Useful for skipping a problematic track without removing it first
    return this.queue.length > 1 ? this.queue[1] : undefined
  }

  public getQueue(): JukeboxQueueItem[] {
    return this.queue
  }

  public async markAsPlayed(queueId: string): Promise<void> {
    try {
      const response = await fetch(`/api/queue/${queueId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger('ERROR', `Failed to mark track as played: ${errorData.message}`)
        throw new Error(`Failed to mark track as played: ${errorData.message}`)
      }

      // Remove the track from the local in-memory queue
      this.queue = this.queue.filter((track) => track.id !== queueId)
    } catch (error) {
      logger(
        'ERROR',
        'Error marking track as played',
        undefined,
        error as Error
      )
      // Re-throw the error to be handled by the calling service
      throw error
    }
  }
}

export const queueManager = QueueManager.getInstance()
export { QueueManager }
