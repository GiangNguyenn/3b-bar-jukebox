import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { queueManager } from '@/services/queueManager'

/**
 * Manages multiple timeouts with named identifiers
 */
export class TimeoutManager {
  private timeouts: Map<string, NodeJS.Timeout> = new Map()

  /**
   * Set a timeout with a named identifier, clearing any existing timeout with the same name
   */
  set(key: string, timeout: NodeJS.Timeout): void {
    this.clear(key)
    this.timeouts.set(key, timeout)
  }

  /**
   * Clear a specific timeout by key
   */
  clear(key: string): void {
    const existing = this.timeouts.get(key)
    if (existing) {
      clearTimeout(existing)
      this.timeouts.delete(key)
    }
  }

  /**
   * Clear all timeouts
   */
  clearAll(): void {
    // Use Array.from to avoid iterator issues with downlevelIteration
    Array.from(this.timeouts.values()).forEach((timeout) => {
      clearTimeout(timeout)
    })
    this.timeouts.clear()
  }

  /**
   * Check if a timeout exists for the given key
   */
  has(key: string): boolean {
    return this.timeouts.has(key)
  }

  /**
   * Get list of all active timeout keys
   */
  getActiveKeys(): string[] {
    return Array.from(this.timeouts.keys())
  }
}

/**
 * Wraps an async operation with standardized error handling and logging
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string,
  logger?: (
    level: LogLevel,
    message: string,
    context?: string,
    error?: Error
  ) => void,
  onError?: (error: unknown) => void
): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    const errorInstance =
      error instanceof Error ? error : new Error(String(error))

    if (logger) {
      logger('ERROR', `Error in ${context}`, context, errorInstance)
    } else {
      console.error(`[${context}] Error:`, errorInstance)
    }

    if (onError) {
      onError(error)
    }

    return null
  }
}

/**
 * Ensures a track is not a duplicate of the currently playing track
 * Removes duplicates from queue and returns the next valid track
 */
export async function ensureTrackNotDuplicate(
  track: JukeboxQueueItem,
  currentTrackId: string,
  maxRemovalAttempts: number = 3,
  logger?: (
    level: LogLevel,
    message: string,
    context?: string,
    error?: Error
  ) => void
): Promise<JukeboxQueueItem | null> {
  let currentTrack: JukeboxQueueItem | null = track
  let attempts = 0

  while (
    currentTrack &&
    currentTrack.tracks.spotify_track_id === currentTrackId &&
    attempts < maxRemovalAttempts
  ) {
    attempts++

    if (logger) {
      logger(
        'WARN',
        `Duplicate track detected (${currentTrackId}). Removing from queue (attempt ${attempts}/${maxRemovalAttempts}).`
      )
    }

    try {
      await queueManager.markAsPlayed(currentTrack.id)

      // Get next track from queue
      currentTrack = queueManager.getNextTrack() ?? null

      if (
        !currentTrack ||
        currentTrack.tracks.spotify_track_id !== currentTrackId
      ) {
        // Successfully found a different track or queue is empty
        break
      }
    } catch (error) {
      if (logger) {
        logger(
          'ERROR',
          `Failed to remove duplicate track (attempt ${attempts})`,
          'DuplicateDetection',
          error instanceof Error ? error : undefined
        )
      }

      if (attempts >= maxRemovalAttempts) {
        // If this was the last attempt, try to get alternative track
        const alternativeTrack = queueManager.getTrackAfterNext()
        if (
          alternativeTrack &&
          alternativeTrack.tracks.spotify_track_id !== currentTrackId
        ) {
          return alternativeTrack
        }
        return null
      }
    }
  }

  // Final check: if track still matches after all attempts, return null
  if (currentTrack && currentTrack.tracks.spotify_track_id === currentTrackId) {
    if (logger) {
      logger(
        'ERROR',
        `Track still matches after ${maxRemovalAttempts} removal attempts. Cannot play duplicate.`
      )
    }
    return null
  }

  return currentTrack
}
