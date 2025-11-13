import { JukeboxQueueItem } from '@/shared/types/queue'

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

  public async markAsPlayed(queueId: string, maxRetries = 2): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`/api/queue/${queueId}`, {
          method: 'DELETE'
        })

        if (response.ok) {
          // Success - remove from local queue
          this.queue = this.queue.filter((track) => track.id !== queueId)
          return
        }

        if (response.status === 404) {
          // Track already removed from database
          // Update local queue to match and treat as success
          this.queue = this.queue.filter((track) => track.id !== queueId)
          console.warn(
            `Track ${queueId} already removed from database (404), updated local queue`
          )
          return
        }

        // Other errors - retry if attempts remain
        if (attempt < maxRetries) {
          const backoffMs = 500 * (attempt + 1)
          console.warn(
            `Failed to mark track ${queueId} as played (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms`
          )
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
          continue
        }

        // Exhausted retries
        const errorData = await response.json()
        console.error(
          `Failed to mark track ${queueId} as played after ${maxRetries + 1} attempts:`,
          errorData.message
        )
        throw new Error(`Failed to mark track as played: ${errorData.message}`)
      } catch (error) {
        // Network or parsing errors
        if (attempt < maxRetries) {
          const backoffMs = 500 * (attempt + 1)
          console.warn(
            `Error marking track ${queueId} as played (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms:`,
            error
          )
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
          continue
        }

        // Exhausted retries
        console.error(
          `An error occurred while marking track ${queueId} as played after ${maxRetries + 1} attempts:`,
          error
        )
        throw error
      }
    }
  }
}

export const queueManager = QueueManager.getInstance()
export { QueueManager }
