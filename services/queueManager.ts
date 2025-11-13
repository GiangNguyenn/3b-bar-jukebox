import { JukeboxQueueItem } from '@/shared/types/queue'

class QueueManager {
  private queue: JukeboxQueueItem[] = []
  private static instance: QueueManager
  // Track IDs currently being deleted to prevent race conditions with queue refreshes
  private pendingDeletes: Set<string> = new Set()

  private constructor() {}

  public static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager()
    }
    return QueueManager.instance
  }

  public updateQueue(newQueue: JukeboxQueueItem[]): void {
    // Filter out any tracks that are currently being deleted
    // This prevents race conditions where a queue refresh brings back tracks
    // that are in the process of being removed
    this.queue = newQueue.filter((track) => !this.pendingDeletes.has(track.id))
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
    // Store the track for potential rollback
    const trackToRemove = this.queue.find((track) => track.id === queueId)

    if (!trackToRemove) {
      console.warn(
        `Track ${queueId} not found in queue, may have already been removed`
      )
      return
    }

    // Optimistically remove from local queue immediately
    // This prevents race conditions with queue refreshes during the DELETE request
    this.queue = this.queue.filter((track) => track.id !== queueId)

    // Mark as pending delete to prevent queue refresh from bringing it back
    this.pendingDeletes.add(queueId)

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`/api/queue/${queueId}`, {
          method: 'DELETE'
        })

        if (response.ok) {
          // Success - remove from pending deletes
          this.pendingDeletes.delete(queueId)
          return
        }

        if (response.status === 404) {
          // Track already removed from database - treat as success
          this.pendingDeletes.delete(queueId)
          console.warn(
            `Track ${queueId} already removed from database (404), continuing`
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

        // Exhausted retries - rollback the optimistic update
        console.error(
          `Failed to mark track ${queueId} as played after ${maxRetries + 1} attempts, rolling back local queue`
        )

        // Add track back to queue at the beginning (it was highest priority)
        this.queue.unshift(trackToRemove)
        this.pendingDeletes.delete(queueId)

        const errorData = await response.json()
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

        // Exhausted retries - rollback the optimistic update
        console.error(
          `An error occurred while marking track ${queueId} as played after ${maxRetries + 1} attempts, rolling back local queue:`,
          error
        )

        // Add track back to queue at the beginning (it was highest priority)
        this.queue.unshift(trackToRemove)
        this.pendingDeletes.delete(queueId)

        throw error
      }
    }
  }
}

export const queueManager = QueueManager.getInstance()
export { QueueManager }
