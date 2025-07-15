'use client'

import { useState } from 'react'
import { sendApiRequest } from '@/shared/api'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { PlayIcon, TrashIcon } from '@heroicons/react/24/outline'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui/loading'
import { TableSkeleton } from '@/components/ui/skeleton'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { useDebouncedCallback } from 'use-debounce'

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
  const [isLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null)
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null)
  const { deviceId } = useSpotifyPlayerStore()
  const { addLog } = useConsoleLogsContext()

  // Use the simpler useNowPlayingTrack hook
  const { data: currentlyPlaying } = useNowPlayingTrack()

  // Debounced refresh to prevent excessive API calls
  const debouncedRefresh = useDebouncedCallback(async () => {
    try {
      await onQueueChanged()
      addLog(
        'INFO',
        'Queue refreshed after debounced update',
        'PlaylistDisplay'
      )
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
      addLog('INFO', `Started playing track: ${trackUri}`, 'PlaylistDisplay')
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
        addLog(
          'INFO',
          `Optimistic update: Removed track ${queueId} from UI`,
          'PlaylistDisplay'
        )
      }

      const response = await fetch(`/api/queue/${queueId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        const errorData: { error?: string } = await response.json()
        throw new Error(errorData.error ?? 'Failed to delete track')
      }

      addLog(
        'INFO',
        `Successfully deleted track ${queueId} from database`,
        'PlaylistDisplay'
      )

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
      addLog(
        'INFO',
        'Error occurred during delete - real-time subscription will correct state',
        'PlaylistDisplay'
      )
    } finally {
      setDeletingTrackId(null)
    }
  }

  if (isLoading && queue.length === 0) {
    return <TableSkeleton rows={10} />
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
      <div className='flex items-center justify-between'>
        <h2 className='text-xl font-semibold'>Queue ({queue.length} tracks)</h2>
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
              // Debug logging
              addLog(
                'INFO',
                `Track comparison: ${JSON.stringify({
                  queueTrackId: item.tracks.spotify_track_id,
                  nowPlayingTrackId: currentlyPlaying?.item?.id,
                  index,
                  isMatch:
                    currentlyPlaying?.item?.id === item.tracks.spotify_track_id
                })}`,
                'PlaylistDisplay'
              )

              const isCurrentlyPlaying =
                currentlyPlaying?.item?.id === item.tracks.spotify_track_id
              const isTrackLoading = loadingTrackId === item.tracks.spotify_url
              const isTrackDeleting = deletingTrackId === item.id

              // Find the next track based on votes
              let isNextTrack = false
              if (isCurrentlyPlaying) {
                // If this is the currently playing track, no next track indicator
                isNextTrack = false
              } else {
                // Find the track with highest votes (excluding currently playing track)
                const availableTracks = queue.filter(
                  (track) =>
                    currentlyPlaying?.item?.id !== track.tracks.spotify_track_id
                )
                if (availableTracks.length > 0) {
                  const nextTrack = availableTracks.reduce((highest, track) =>
                    track.votes > highest.votes ? track : highest
                  )
                  isNextTrack = item.id === nextTrack.id
                }
              }

              return (
                <tr
                  key={item.id}
                  className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/50 ${
                    isCurrentlyPlaying ? 'bg-green-900/20' : ''
                  } ${isNextTrack ? 'bg-blue-900/20' : ''}`}
                >
                  <td className='px-4 py-3 text-sm text-gray-400'>
                    {isCurrentlyPlaying ? (
                      <div className='flex items-center gap-2'>
                        {index + 1}
                        <span className='h-2 w-2 animate-pulse rounded-full bg-green-500'></span>
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
                    {isNextTrack && (
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
                        disabled={isTrackLoading || isTrackDeleting}
                        className='hover:text-white rounded p-1 text-gray-400 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                        title='Remove from queue'
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
