'use client'

import { useEffect, useState, useCallback } from 'react'
import { sendApiRequest } from '@/shared/api'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { PlayIcon, TrashIcon } from '@heroicons/react/24/outline'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui/loading'
import { TableSkeleton } from '@/components/ui/skeleton'
import { TrackDetails, SpotifyArtist } from '@/shared/types/spotify'

interface SpotifyPlaylistTrack {
  track: TrackDetails | null
}

interface PlaylistDisplayProps {
  playlistId: string
}

export function PlaylistDisplay({
  playlistId
}: PlaylistDisplayProps): JSX.Element {
  const [tracks, setTracks] = useState<SpotifyPlaylistTrack[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null)
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null)
  const { playbackState, deviceId } = useSpotifyPlayerStore()

  const fetchPlaylistTracks = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await sendApiRequest<{
        items: SpotifyPlaylistTrack[]
      }>({
        path: `playlists/${playlistId}/tracks`,
        method: 'GET'
      })

      if (response?.items) {
        setTracks(response.items)
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch playlist tracks'
      )
    } finally {
      setIsLoading(false)
    }
  }, [playlistId])

  useEffect((): void => {
    if (playlistId) {
      void fetchPlaylistTracks()
    }
  }, [playlistId, fetchPlaylistTracks])

  // Add auto-refresh effect
  useEffect((): (() => void) => {
    if (!playlistId) return () => undefined

    const refreshInterval = setInterval(() => {
      void fetchPlaylistTracks()
    }, 180000) // 3 minutes

    return () => clearInterval(refreshInterval)
  }, [playlistId, fetchPlaylistTracks])

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
          context_uri: `spotify:playlist:${playlistId}`,
          offset: { uri: trackUri }
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play track')
    } finally {
      setLoadingTrackId(null)
    }
  }

  const handleDeleteTrack = async (trackUri: string): Promise<void> => {
    try {
      setDeletingTrackId(trackUri)
      await sendApiRequest({
        path: `playlists/${playlistId}/tracks`,
        method: 'DELETE',
        body: {
          tracks: [{ uri: trackUri }]
        }
      })
      // Remove the track from the local state
      setTracks((prev) => prev.filter((t) => t.track?.uri !== trackUri))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete track')
    } finally {
      setDeletingTrackId(null)
    }
  }

  if (isLoading) {
    return <TableSkeleton rows={8} />
  }

  if (error) {
    return <ErrorMessage message={error} onDismiss={() => setError(null)} />
  }

  if (tracks.length === 0) {
    return (
      <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4 text-gray-400'>
        No tracks found in playlist
      </div>
    )
  }

  // Find the index of the currently playing track
  const currentTrackIndex = tracks.findIndex(
    (track) => track.track?.id === playbackState?.item?.id
  )

  return (
    <div className='space-y-4'>
      <div className='rounded-lg border border-gray-800 bg-gray-900/50'>
        <div className='overflow-x-auto'>
          <table className='w-full table-fixed'>
            <thead>
              <tr className='border-b border-gray-800'>
                <th className='w-16 px-4 py-3 text-left text-sm font-medium text-gray-400'>
                  #
                </th>
                <th className='w-1/3 px-4 py-3 text-left text-sm font-medium text-gray-400'>
                  Title
                </th>
                <th className='w-1/4 px-4 py-3 text-left text-sm font-medium text-gray-400'>
                  Artist
                </th>
                <th className='w-1/4 px-4 py-3 text-left text-sm font-medium text-gray-400'>
                  Album
                </th>
                <th className='w-24 px-4 py-3 text-left text-sm font-medium text-gray-400'>
                  Duration
                </th>
                <th className='w-24 px-4 py-3 text-left text-sm font-medium text-gray-400'>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {[...tracks].reverse().map((track, index) => {
                const isCurrentlyPlaying =
                  track.track?.id === playbackState?.item?.id
                const isTrackLoading = loadingTrackId === track.track?.uri
                const isTrackDeleting = deletingTrackId === track.track?.uri
                const isNextTrack =
                  currentTrackIndex !== -1 &&
                  index === tracks.length - currentTrackIndex - 2

                return (
                  <tr
                    key={track.track?.id}
                    className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/50 ${
                      isCurrentlyPlaying ? 'bg-green-900/20' : ''
                    } ${isNextTrack ? 'bg-blue-900/20' : ''}`}
                  >
                    <td className='px-4 py-3 text-sm text-gray-400'>
                      {isCurrentlyPlaying ? (
                        <div className='flex items-center gap-2'>
                          <span className='h-2 w-2 animate-pulse rounded-full bg-green-500'></span>
                          {tracks.length - index}
                        </div>
                      ) : isNextTrack ? (
                        <div className='flex items-center gap-2'>
                          <span className='h-2 w-2 rounded-full bg-blue-500'></span>
                          {tracks.length - index}
                        </div>
                      ) : (
                        tracks.length - index
                      )}
                    </td>
                    <td className='text-white px-4 py-3 text-sm'>
                      {track.track?.name}
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
                      {track.track?.artists
                        ?.map((artist: SpotifyArtist) => artist.name)
                        .join(', ')}
                    </td>
                    <td className='px-4 py-3 text-sm text-gray-400'>
                      {track.track?.album?.name}
                    </td>
                    <td className='px-4 py-3 text-sm text-gray-400'>
                      {formatDuration(track.track?.duration_ms ?? 0)}
                    </td>
                    <td className='px-4 py-3 text-sm'>
                      <div className='flex items-center gap-2'>
                        <button
                          onClick={() =>
                            track.track?.uri &&
                            void handlePlayTrack(track.track.uri)
                          }
                          disabled={
                            isTrackLoading ||
                            isTrackDeleting ||
                            !track.track?.uri
                          }
                          className='hover:text-white rounded p-1 text-gray-400 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50'
                          title='Play track'
                        >
                          {isTrackLoading ? (
                            <Loading className='h-4 w-4' />
                          ) : (
                            <PlayIcon className='h-4 w-4' />
                          )}
                        </button>
                        <button
                          onClick={() =>
                            track.track?.uri &&
                            void handleDeleteTrack(track.track.uri)
                          }
                          disabled={
                            isTrackLoading ||
                            isTrackDeleting ||
                            !track.track?.uri ||
                            isNextTrack
                          }
                          className='hover:text-white rounded p-1 text-gray-400 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                          title={
                            isNextTrack
                              ? "Can't delete next track"
                              : 'Delete track'
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
    </div>
  )
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
