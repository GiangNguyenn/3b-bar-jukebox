'use client'

import { useState, useEffect } from 'react'
import {
  XMarkIcon,
  HeartIcon,
  MusicalNoteIcon
} from '@heroicons/react/24/outline'
import { Loading } from '@/components/ui/loading'
import { ErrorMessage } from '@/components/ui/error-message'
import { PlaylistListItem } from '@/shared/types/spotify'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'

interface PlaylistImportModalProps {
  isOpen: boolean
  onClose: () => void
  username: string
  onImportComplete: () => Promise<void>
}

interface ImportSummary {
  success: number
  skipped: number
  failed: number
  errors: string[]
}

export function PlaylistImportModal({
  isOpen,
  onClose,
  username,
  onImportComplete
}: PlaylistImportModalProps): JSX.Element | null {
  const [playlists, setPlaylists] = useState<PlaylistListItem[]>([])
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const { addLog } = useConsoleLogsContext()

  // Fetch playlists when modal opens
  useEffect(() => {
    if (isOpen && playlists.length === 0) {
      void fetchPlaylists()
    }
  }, [isOpen])

  const fetchPlaylists = async (): Promise<void> => {
    setIsLoadingPlaylists(true)
    setError(null)

    try {
      const response = await fetch(`/api/playlists/${username}`)

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: 'Unknown error' }))
        const errorMsg =
          typeof errorData === 'object' &&
          errorData !== null &&
          'error' in errorData
            ? String(errorData.error)
            : 'Failed to fetch playlists'
        throw new Error(errorMsg)
      }

      const data = (await response.json()) as { playlists: PlaylistListItem[] }
      setPlaylists(data.playlists)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch playlists'
      setError(errorMessage)
      addLog(
        'ERROR',
        `Failed to fetch playlists: ${errorMessage}`,
        'PlaylistImportModal',
        err instanceof Error ? err : undefined
      )
    } finally {
      setIsLoadingPlaylists(false)
    }
  }

  const handleImport = async (
    playlistId: string | null,
    playlistName: string
  ): Promise<void> => {
    setIsImporting(true)
    setError(null)
    setImportMessage(null)

    try {
      const response = await fetch(`/api/playlist-import/${username}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ playlistId })
      })

      if (!response.ok) {
        throw new Error('Failed to import tracks')
      }

      const summary = (await response.json()) as ImportSummary

      // Create summary message
      const parts = []
      if (summary.success > 0) {
        parts.push(`${summary.success} added`)
      }
      if (summary.skipped > 0) {
        parts.push(`${summary.skipped} already in playlist`)
      }
      if (summary.failed > 0) {
        parts.push(`${summary.failed} failed`)
      }

      const message =
        parts.length > 0
          ? `Import from "${playlistName}" complete: ${parts.join(', ')}`
          : 'No tracks to import'

      setImportMessage(message)

      // Log any errors
      if (summary.errors.length > 0) {
        addLog(
          'ERROR',
          `Import encountered ${summary.errors.length} errors`,
          'PlaylistImportModal'
        )
        summary.errors.forEach((err, index) => {
          if (err && err.trim()) {
            addLog(
              'ERROR',
              `Import error ${index + 1}: ${err}`,
              'PlaylistImportModal'
            )
          }
        })

        // Show first error to user if import was not successful
        const firstError = summary.errors.find((e) => e && e.trim())
        if (firstError && summary.success === 0) {
          setError(`Import failed: ${firstError}`)
        }
      }

      // Refresh the queue
      await onImportComplete()

      // Close modal after a brief delay to show success message
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to import tracks'
      setError(errorMessage)
      addLog(
        'ERROR',
        `Failed to import tracks: ${errorMessage}`,
        'PlaylistImportModal',
        err instanceof Error ? err : undefined
      )
    } finally {
      setIsImporting(false)
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'>
      <div className='relative max-h-[80vh] w-full max-w-2xl rounded-lg border border-gray-800 bg-gray-900 shadow-xl'>
        {/* Header */}
        <div className='flex items-center justify-between border-b border-gray-800 p-4'>
          <h2 className='text-white text-xl font-semibold'>Import Tracks</h2>
          <button
            onClick={onClose}
            disabled={isImporting}
            className='hover:text-white rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50'
            aria-label='Close modal'
          >
            <XMarkIcon className='h-6 w-6' />
          </button>
        </div>

        {/* Content */}
        <div
          className='overflow-y-auto p-4'
          style={{ maxHeight: 'calc(80vh - 8rem)' }}
        >
          {error && (
            <ErrorMessage message={error} onDismiss={() => setError(null)} />
          )}

          {importMessage && (
            <div className='mb-4 rounded-lg border border-green-800 bg-green-900/20 p-3 text-sm text-green-400'>
              {importMessage}
            </div>
          )}

          {isLoadingPlaylists ? (
            <div className='flex items-center justify-center py-8'>
              <Loading className='h-8 w-8' />
              <span className='ml-3 text-gray-400'>Loading playlists...</span>
            </div>
          ) : (
            <div className='space-y-2'>
              {/* Liked Songs Option */}
              <button
                onClick={() => void handleImport(null, 'Liked Songs')}
                disabled={isImporting}
                className='flex w-full items-center gap-4 rounded-lg border border-gray-800 bg-gray-800/50 p-4 text-left transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50'
              >
                <div className='flex h-16 w-16 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-blue-600'>
                  <HeartIcon className='text-white h-8 w-8' />
                </div>
                <div className='flex-1'>
                  <h3 className='text-white font-semibold'>Liked Songs</h3>
                  <p className='text-sm text-gray-400'>
                    Import your liked songs
                  </p>
                </div>
                {isImporting && <Loading className='h-5 w-5' />}
              </button>

              {/* Playlists */}
              {playlists.length === 0 ? (
                <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4 text-center text-gray-400'>
                  No playlists found
                </div>
              ) : (
                playlists.map((playlist) => (
                  <button
                    key={playlist.id}
                    onClick={() =>
                      void handleImport(playlist.id, playlist.name)
                    }
                    disabled={isImporting}
                    className='flex w-full items-center gap-4 rounded-lg border border-gray-800 bg-gray-800/50 p-4 text-left transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    <div className='h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-700'>
                      {playlist.imageUrl ? (
                        <img
                          src={playlist.imageUrl}
                          alt={playlist.name}
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <div className='flex h-full w-full items-center justify-center'>
                          <MusicalNoteIcon className='h-8 w-8 text-gray-500' />
                        </div>
                      )}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <h3 className='text-white truncate font-semibold'>
                        {playlist.name}
                      </h3>
                      <p className='text-sm text-gray-400'>
                        {playlist.trackCount}{' '}
                        {playlist.trackCount === 1 ? 'track' : 'tracks'}
                        {' • '}
                        {playlist.ownerName}
                      </p>
                    </div>
                    {isImporting && <Loading className='h-5 w-5' />}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='border-t border-gray-800 p-4'>
          <button
            onClick={onClose}
            disabled={isImporting}
            className='text-white w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50'
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
