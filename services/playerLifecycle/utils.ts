import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { queueManager } from '@/services/queueManager'
import { PLAYER_LIFECYCLE_CONFIG } from '../playerLifecycleConfig'

import type {} from 'scheduler-polyfill'

if (typeof window !== 'undefined') {
  require('scheduler-polyfill')
}

/**
 * Waits for the Spotify Web Playback SDK to be ready
 */
export function waitForSpotifySDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Spotify) {
      resolve()
      return
    }

    const { maxWaitMs, checkIntervalMs } = PLAYER_LIFECYCLE_CONFIG.SDK_LOADING
    const startTime = Date.now()

    const intervalId = setInterval(() => {
      if (window.Spotify) {
        clearInterval(intervalId)
        resolve()
        return
      }

      const elapsedTime = Date.now() - startTime
      if (elapsedTime > maxWaitMs) {
        clearInterval(intervalId)
        reject(new Error(`Spotify SDK failed to load within ${maxWaitMs}ms`))
      }
    }, checkIntervalMs)

    // Also listen for the event as a backup/faster trigger
    const onSdkReady = () => {
      clearInterval(intervalId)
      window.removeEventListener('spotifySDKReady', onSdkReady)
      resolve()
    }
    window.addEventListener('spotifySDKReady', onSdkReady)
  })
}

/**
 * Manages multiple timeouts with named identifiers, utilizing the Prioritized Task Scheduling API where possible.
 */
export class TimeoutManager {
  private controllers: Map<string, AbortController> = new Map()

  /**
   * Set a task with a named identifier, clearing any existing task with the same name
   * @param key Identifier for the task
   * @param callback Function to execute
   * @param delayMs Delay in milliseconds
   * @param priority Task priority ('user-blocking', 'user-visible', 'background')
   */
  setTask(
    key: string,
    callback: () => void,
    delayMs: number,
    priority: 'user-blocking' | 'user-visible' | 'background' = 'background'
  ): void {
    this.clear(key)
    const controller = new AbortController()
    this.controllers.set(key, controller)

    if (typeof scheduler !== 'undefined' && scheduler.postTask) {
      scheduler
        .postTask(callback, {
          priority,
          delay: delayMs,
          signal: controller.signal
        })
        .then(() => {
          this.controllers.delete(key)
        })
        .catch((err: unknown) => {
          this.controllers.delete(key)
          if (err instanceof Error && err.name !== 'AbortError') {
            throw err
          }
        })
    } else {
      // Fallback
      const timeoutId = setTimeout(() => {
        if (!controller.signal.aborted) {
          try {
            callback()
          } finally {
            this.controllers.delete(key)
          }
        }
      }, delayMs)

      controller.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId)
      })
    }
  }

  /**
   * Clear a specific timeout by key
   */
  clear(key: string): void {
    const existing = this.controllers.get(key)
    if (existing) {
      existing.abort()
      this.controllers.delete(key)
    }
  }

  /**
   * Clear all timeouts
   */
  clearAll(): void {
    Array.from(this.controllers.values()).forEach((controller) => {
      controller.abort()
    })
    this.controllers.clear()
  }

  /**
   * Check if a timeout exists for the given key
   */
  has(key: string): boolean {
    return this.controllers.has(key)
  }

  /**
   * Get list of all active timeout keys
   */
  getActiveKeys(): string[] {
    return Array.from(this.controllers.keys())
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
