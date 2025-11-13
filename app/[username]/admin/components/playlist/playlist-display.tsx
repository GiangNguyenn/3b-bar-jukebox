'use client'

import { useState, useEffect } from 'react'
import { sendApiRequest } from '@/shared/api'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { getAutoPlayService } from '@/services/autoPlayService'
import {
  PlayIcon,
  TrashIcon,
  MusicalNoteIcon
} from '@heroicons/react/24/outline'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui/loading'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { useDebouncedCallback } from 'use-debounce'
import { PlaylistImportModal } from './playlist-import-modal'

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
  username?: string
}

export function PlaylistDisplay({
  queue,
  onQueueChanged,
  optimisticUpdate,
  username
}: PlaylistDisplayProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null)
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
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

  const handleDeleteTrack = async (queueId: string): Promise<void> => {
    try {
      setDeletingTrackId(queueId)
      setError(null)

      // Optimistic update - remove track from UI immediately
      if (optimisticUpdate) {
        optimisticUpdate((currentQueue) =>
          currentQueue.filter((item) => item.id !== queueId)
        )
      }

      const response = await fetch(`/api/queue/${queueId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const errorData: { error?: string } = await response.json()
        throw new Error(errorData.error ?? 'Failed to delete track')
      }

      // Trigger debounced refresh to sync with real-time updates
      void debouncedRefresh()
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to delete track'
      setError(errorMessage)
      addLog(
        'ERROR',
        `Failed to delete track: ${errorMessage}`,
        'PlaylistDisplay',
        err instanceof Error ? err : undefined
      )

      // If optimistic update was used, we should revert it on error
      // However, since we're using real-time subscriptions, the next update will correct the state
    } finally {
      setDeletingTrackId(null)
    }
  }

  const handleImportComplete = async (): Promise<void> => {
    await onQueueChanged()
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

  return (
    <div className='space-y-4'>
      <PlaylistImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        username={username ?? ''}
        onImportComplete={handleImportComplete}
      />

      <div className='flex items-center justify-between'>
        <h2 className='text-xl font-semibold'>Queue ({queue.length} tracks)</h2>
        <button
          onClick={() => setIsImportModalOpen(true)}
          disabled={!username}
          className='text-white flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50'
        >
          <MusicalNoteIcon className='h-4 w-4' />
          Import Tracks
        </button>
      </div>

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
              const isTrackDeleting = deletingTrackId === item.id
              const isLockedTrack =
                lockedTrackId === item.tracks.spotify_track_id

              // Determine if this is the next track to play
              // Queue is already sorted by votes DESC, queued_at ASC from database
              // (see api/playlist/[id]/route.ts lines 41-42)
              // So the first non-playing track is the next track
              let isNextTrack = false
              if (!isCurrentlyPlaying && !isLockedTrack) {
                const availableTracks = queue.filter(
                  (track) =>
                    playbackState?.item?.id !== track.tracks.spotify_track_id
                )
                // First available track is next (already properly sorted)
                isNextTrack =
                  availableTracks.length > 0 &&
                  item.id === availableTracks[0].id
              }

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
                        onClick={() => void handleDeleteTrack(item.id)}
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
