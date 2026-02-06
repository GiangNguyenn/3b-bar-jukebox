import { JukeboxQueueItem } from '@/shared/types/queue'

import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('QueueManager')

class QueueManager {
  private queue: JukeboxQueueItem[] = []
  private static instance: QueueManager
  // Track IDs currently being deleted to prevent race conditions with queue refreshes
  private pendingDeletes: Set<string> = new Set()
  // Track the currently playing track ID to exclude it from getNextTrack()
  private currentlyPlayingTrackId: string | null = null

  private constructor() { }

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
    // Always exclude the currently playing track to return the actual next scheduled track
    const availableTracks = this.currentlyPlayingTrackId
      ? this.queue.filter(
        (track) =>
          track.tracks.spotify_track_id !== this.currentlyPlayingTrackId
      )
      : this.queue

    // Return the highest priority next track to play (ordered by votes DESC, queued_at ASC)
    return availableTracks.length > 0 ? availableTracks[0] : undefined
  }

  /**
   * Set the currently playing track ID.
   * This should be called when a track starts playing to ensure getNextTrack() excludes it.
   */
  public setCurrentlyPlayingTrack(trackId: string | null): void {
    this.currentlyPlayingTrackId = trackId
  }

  /**
   * Get the currently playing track ID.
   */
  public getCurrentlyPlayingTrack(): string | null {
    return this.currentlyPlayingTrackId
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
      logger(
        'WARN',
        `[markAsPlayed] Track ${queueId} not found in queue, may have already been removed`
      )
      return
    }

    logger(
      'INFO',
      `[markAsPlayed] Starting removal for track: ${trackToRemove.tracks.name} (${queueId}) - optimizations enabled`
    )

    // Optimistically remove from local queue immediately
    // This prevents race conditions with queue refreshes during the DELETE request
    // NOTE: There is a small window between optimistic removal (line 53) and rollback (lines 95, 119)
    // where getNextTrack() could return a track that will be rolled back if the API call fails.
    // This is an acceptable risk because:
    // 1. The window is very small (typically < 1 second for API calls)
    // 2. If API call succeeds, rollback never happens (most common case)
    // 3. If API call fails, an error is thrown which callers should handle
    // 4. The pendingDeletes Set prevents queue refresh from bringing back tracks during deletion
    this.queue = this.queue.filter((track) => track.id !== queueId)

    // Mark as pending delete to prevent queue refresh from bringing it back
    // This protects against race conditions with updateQueue() calls
    this.pendingDeletes.add(queueId)

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout
        let response: Response

        try {
          response = await fetch(`/api/queue/${queueId}`, {
            method: 'DELETE',
            signal: controller.signal
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (response.ok) {
          // Success - remove from pending deletes
          this.pendingDeletes.delete(queueId)
          return
        }

        if (response.status === 404) {
          // Track already removed from database - treat as success
          this.pendingDeletes.delete(queueId)
          logger(
            'WARN',
            `[markAsPlayed] Track ${queueId} already removed from database (404), treating as success`
          )
          return
        }

        // Other errors - retry if attempts remain
        if (attempt < maxRetries) {
          const backoffMs = 500 * (attempt + 1)
          logger(
            'WARN',
            `[markAsPlayed] Failed to mark track ${queueId} as played (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms. Status: ${response.status}`
          )
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
          continue
        }

        // Exhausted retries - rollback the optimistic update
        logger(
          'ERROR',
          `[markAsPlayed] Failed to mark track ${queueId} as played after ${maxRetries + 1} attempts, rolling back local queue`
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
          logger(
            'WARN',
            `[markAsPlayed] Error marking track ${queueId} as played (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms`,
            undefined,
            error as Error
          )
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
          continue
        }

        // Exhausted retries - rollback the optimistic update
        logger(
          'ERROR',
          `[markAsPlayed] Exception while marking track ${queueId} as played after ${maxRetries + 1} attempts, rolling back local queue`,
          undefined,
          error as Error
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
