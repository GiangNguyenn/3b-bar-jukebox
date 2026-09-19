'use client'

import { useState, useEffect, useRef } from 'react'
import { sendApiRequest } from '@/shared/api'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { getAutoPlayService } from '@/services/autoPlayService'
import { PlayIcon, TrashIcon } from '@heroicons/react/24/outline'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui/loading'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { useDebouncedCallback } from 'use-debounce'
import { queueManager } from '@/services/queueManager'
import {
  blockRemovedTrack,
  unblockTrack
} from '@/services/removedTrackBlocklist'
import { sortQueueByPriority } from '@/shared/utils/queueSort'

interface PlaybackState {
  item?: {
    id: string
  }
}

interface PlaylistDisplayProps {
  queue: JukeboxQueueItem[]
  onQueueChanged: () => Promise<void>
  optimisticUpdate?: (
    updater: (currentQueue: JukeboxQueueItem[]) => JukeboxQueueItem[]
  ) => void
}

export function PlaylistDisplay({
  queue,
  onQueueChanged,
  optimisticUpdate
}: PlaylistDisplayProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null)
  // Several deletes can be in flight at once (admin clicking quickly), so track
  // them as a set; the ref guards against a double-fire before state re-renders.
  const [deletingTrackIds, setDeletingTrackIds] = useState<Set<string>>(
    () => new Set()
  )
  const inFlightDeletesRef = useRef<Set<string>>(new Set())
  // Delete failures show as a banner above the table instead of replacing it
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { deviceId } = useSpotifyPlayerStore()
  const { addLog } = useConsoleLogsContext()
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null)

  // Fetch current playback state from Spotify API (more reliable than SDK after transitions)
  const fetchPlaybackState = async (): Promise<void> => {
    try {
      const state = await sendApiRequest({
        path: 'me/player',
        method: 'GET'
      })
      setPlaybackState(state as PlaybackState)
    } catch {
      // Silently fail - playback might be stopped
    }
  }

  // Poll playback state every 5 seconds
  useEffect(() => {
    void fetchPlaybackState()

    const interval = setInterval(() => {
      void fetchPlaybackState()
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  // Immediately fetch playback state on queue changes (track transitions)
  useEffect(() => {
    if (queue.length > 0) {
      void fetchPlaybackState()
    }
  }, [queue])

  // Debounced refresh to prevent excessive API calls
  const debouncedRefresh = useDebouncedCallback(async () => {
    try {
      await onQueueChanged()
      // INFO logs suppressed per logging policy
    } catch (err) {
      addLog(
        'ERROR',
        'Failed to refresh queue after debounced update',
        'PlaylistDisplay',
        err instanceof Error ? err : undefined
      )
    }
  }, 1000)

  const handlePlayTrack = async (trackUri: string): Promise<void> => {
    if (!deviceId) {
      setError('No active device found')
      return
    }

    try {
      setLoadingTrackId(trackUri)
      await sendApiRequest({
        path: `me/player/play?device_id=${deviceId}`,
        method: 'PUT',
        body: {
          uris: [trackUri]
        }
      })
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to play track'
      setError(errorMessage)
      addLog(
        'ERROR',
        `Failed to play track: ${errorMessage}`,
        'PlaylistDisplay',
        err instanceof Error ? err : undefined
      )
    } finally {
      setLoadingTrackId(null)
    }
  }

  const handleDeleteTrack = async (item: JukeboxQueueItem): Promise<void> => {
    const queueId = item.id
    if (inFlightDeletesRef.current.has(queueId)) return
    inFlightDeletesRef.current.add(queueId)

    setDeleteError(null)
    setDeletingTrackIds((prev) => new Set(prev).add(queueId))

    // Stop auto-fill from putting this song straight back (session only).
    // Done before the DELETE: its success triggers an auto-fill check.
    blockRemovedTrack({
      id: item.tracks.spotify_track_id,
      title: item.tracks.name,
      artist: item.tracks.artist
    })

    // Optimistic update - remove track from UI immediately
    optimisticUpdate?.((currentQueue) =>
      currentQueue.filter((queueItem) => queueItem.id !== queueId)
    )

    try {
      // queueManager hides the row from every queue refresh while the DELETE is
      // in flight and for a while after it succeeds, so stale fetches can't
      // bring it back; it also retries and rolls its own queue back on failure.
      await queueManager.removeFromQueue(item)

      // Trigger debounced refresh to sync with real-time updates
      void debouncedRefresh()
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to delete track'

      // Revert: put the song back in the list and allow auto-fill to pick it again
      unblockTrack(item.tracks.spotify_track_id)
      optimisticUpdate?.((currentQueue) =>
        currentQueue.some((queueItem) => queueItem.id === queueId)
          ? currentQueue
          : sortQueueByPriority([...currentQueue, item])
      )

      setDeleteError(`Couldn't remove "${item.tracks.name}": ${errorMessage}`)
      addLog(
        'ERROR',
        `Failed to delete track: ${errorMessage}`,
        'PlaylistDisplay',
        err instanceof Error ? err : undefined
      )
    } finally {
      inFlightDeletesRef.current.delete(queueId)
      setDeletingTrackIds((prev) => {
        const next = new Set(prev)
        next.delete(queueId)
        return next
      })
    }
  }

  if (error) {
    return (
      <ErrorMessage message={error ?? ''} onDismiss={() => setError(null)} />
    )
  }

  if (queue.length === 0) {
    return (
      <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4 text-center text-gray-400'>
        The queue is empty. Add some tracks!
      </div>
    )
  }

  const nextQueueTrack = queueManager.getNextTrack()

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h2 className='text-xl font-semibold'>Queue ({queue.length} tracks)</h2>
      </div>

      {deleteError && (
        <ErrorMessage
          message={deleteError}
          onDismiss={() => setDeleteError(null)}
        />
      )}

      <div className='overflow-hidden rounded-lg border border-gray-800'>
        <table className='w-full'>
          <thead className='bg-gray-900/50'>
            <tr>
              <th className='px-4 py-3 text-left text-sm font-medium text-gray-400'>
                #
              </th>
              <th className='px-4 py-3 text-left text-sm font-medium text-gray-400'>
                Votes
              </th>
              <th className='px-4 py-3 text-left text-sm font-medium text-gray-400'>
                Track
              </th>
              <th className='px-4 py-3 text-left text-sm font-medium text-gray-400'>
                Artist
              </th>
              <th className='px-4 py-3 text-left text-sm font-medium text-gray-400'>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {queue.map((item, index) => {
              // Get fresh lock state on every render - single source of truth
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
              const lockedTrackId = getAutoPlayService().getLockedTrackId()

              const isCurrentlyPlaying =
                playbackState?.item?.id === item.tracks.spotify_track_id
              const isTrackLoading = loadingTrackId === item.tracks.spotify_url
              const isTrackDeleting = deletingTrackIds.has(item.id)
              const isLockedTrack =
                lockedTrackId === item.tracks.spotify_track_id

              // Determine if this is the next track to play using the canonical
              // queueManager selection logic so UI stays in sync with playback.
              const isNextTrack =
                !isCurrentlyPlaying &&
                !isLockedTrack &&
                nextQueueTrack?.id === item.id

              return (
                <tr
                  key={item.id}
                  className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/50 ${
                    isCurrentlyPlaying
                      ? 'bg-green-900/20'
                      : isLockedTrack
                        ? 'bg-orange-900/20'
                        : isNextTrack
                          ? 'bg-blue-900/20'
                          : ''
                  }`}
                >
                  <td className='px-4 py-3 text-sm text-gray-400'>
                    {isCurrentlyPlaying ? (
                      <div className='flex items-center gap-2'>
                        {index + 1}
                        <span className='h-2 w-2 animate-pulse rounded-full bg-green-500'></span>
                      </div>
                    ) : isLockedTrack ? (
                      <div className='flex items-center gap-2'>
                        {index + 1}
                        <span className='h-2 w-2 rounded-full bg-orange-500'></span>
                      </div>
                    ) : isNextTrack ? (
                      <div className='flex items-center gap-2'>
                        {index + 1}
                        <span className='h-2 w-2 rounded-full bg-blue-500'></span>
                      </div>
                    ) : (
                      index + 1
                    )}
                  </td>
                  <td className='px-4 py-3 text-sm text-gray-400'>
                    {item.votes}
                  </td>
                  <td className='text-white px-4 py-3 text-sm'>
                    <span title={item.tracks.name}>
                      {item.tracks.name.length > 20
                        ? `${item.tracks.name.substring(0, 20)}...`
                        : item.tracks.name}
                    </span>
                    {isCurrentlyPlaying && (
                      <span className='ml-2 text-xs text-green-500'>
                        (Now Playing)
                      </span>
                    )}
                    {isLockedTrack && !isCurrentlyPlaying && (
                      <span className='ml-2 text-xs text-orange-500'>
                        (Locked in to play next)
                      </span>
                    )}
                    {isNextTrack && !isLockedTrack && (
                      <span className='ml-2 text-xs text-blue-500'>
                        (Next Up)
                      </span>
                    )}
                  </td>
                  <td className='px-4 py-3 text-sm text-gray-400'>
                    <span title={item.tracks.artist}>
                      {item.tracks.artist.length > 20
                        ? `${item.tracks.artist.substring(0, 20)}...`
                        : item.tracks.artist}
                    </span>
                  </td>
                  <td className='px-4 py-3 text-sm'>
                    <div className='flex items-center gap-2'>
                      <button
                        onClick={() =>
                          void handlePlayTrack(item.tracks.spotify_url)
                        }
                        disabled={isTrackLoading || isTrackDeleting}
                        className='hover:text-white rounded p-1 text-gray-400 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50'
                        title='Play this track'
                      >
                        {isTrackLoading ? (
                          <Loading className='h-4 w-4' />
                        ) : (
                          <PlayIcon className='h-4 w-4' />
                        )}
                      </button>
                      <button
                        onClick={() => void handleDeleteTrack(item)}
                        disabled={
                          isTrackLoading ||
                          isTrackDeleting ||
                          isCurrentlyPlaying ||
                          isLockedTrack
                        }
                        className='hover:text-white rounded p-1 text-gray-400 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                        title={
                          isCurrentlyPlaying
                            ? 'Cannot delete currently playing track'
                            : isLockedTrack
                              ? 'Track is locked - queued to play next in Spotify'
                              : 'Remove from queue'
                        }
                      >
                        {isTrackDeleting ? (
                          <Loading className='h-4 w-4' />
                        ) : (
                          <TrashIcon className='h-4 w-4' />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
