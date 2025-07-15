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
    return this.queue.length > 0 ? this.queue[0] : undefined
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
        console.error('Failed to mark track as played:', errorData.message)
        throw new Error(`Failed to mark track as played: ${errorData.message}`)
      }

      // Remove the track from the local in-memory queue
      this.queue = this.queue.filter((track) => track.id !== queueId)
    } catch (error) {
      console.error('An error occurred while marking track as played:', error)
      // Re-throw the error to be handled by the calling service
      throw error
    }
  }
}

export const queueManager = QueueManager.getInstance()
export { QueueManager }
