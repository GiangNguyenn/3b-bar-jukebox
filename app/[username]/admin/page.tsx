'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { Suspense } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AdminPageContent } from './components/admin-page-content'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { PlaylistDisplay } from './components/playlist/playlist-display'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'

interface PlaybackStateWithRemainingTracks extends SpotifyPlaybackState {
  remainingTracks: number
  progress_ms: number
  duration_ms: number
  timeUntilEnd: number
  lastProgressCheck: number
  progressStalled: boolean
}

export default function AdminPage(): JSX.Element {
  const handlePlaybackUpdateRef = useRef<((event: Event) => void) | null>(null)
  const [activeTab, setActiveTab] = useState('playback')
  const { fixedPlaylistId } = useFixedPlaylist()
  const { addLog } = useConsoleLogsContext()

  const handlePlaybackUpdate = useCallback((event: Event): void => {
    const state = (event as CustomEvent<PlaybackStateWithRemainingTracks>).detail
    if (!state) return

    addLog(
      'INFO',
      `[Playback] State updated: isPlaying=${state.is_playing}, track=${state.item?.name ?? 'none'}, progress=${state.progress_ms}, timestamp=${new Date().toISOString()}`,
      'Playback',
      undefined
    )
  }, [addLog])

  useEffect((): (() => void) => {
    handlePlaybackUpdateRef.current = handlePlaybackUpdate
    window.addEventListener('playbackUpdate', handlePlaybackUpdate)
    return () => {
      window.removeEventListener('playbackUpdate', handlePlaybackUpdate)
    }
  }, [handlePlaybackUpdate])

  const handleTrackSuggestionsStateChange = (state: TrackSuggestionsState): void => {
    addLog(
      'INFO',
      `[Track Suggestions] State updated: ${JSON.stringify(state)}`,
      'Track Suggestions',
      undefined
    )
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black">
        <Suspense fallback={<div className="p-4 text-white">Loading...</div>}>
          <Tabs
            value={activeTab}
            onValueChange={(value: string): void => {
              if (
                value === 'playback' ||
                value === 'settings' ||
                value === 'playlist'
              ) {
                setActiveTab(value)
              }
            }}
            className='space-y-4'
          >
            <TabsList className='grid w-full grid-cols-3 bg-gray-800/50'>
              <TabsTrigger
                value='playback'
                className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
              >
                Dashboard
              </TabsTrigger>
              <TabsTrigger
                value='settings'
                className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
              >
                Track Suggestions
              </TabsTrigger>
              <TabsTrigger
                value='playlist'
                className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
              >
                Playlist
              </TabsTrigger>
            </TabsList>

            <TabsContent value='playback'>
              <AdminPageContent />
            </TabsContent>

            <TabsContent value='settings'>
              <TrackSuggestionsTab onStateChange={handleTrackSuggestionsStateChange} />
            </TabsContent>

            <TabsContent value='playlist'>
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-white">Playlist Management</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      View and manage your playlist
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
                  {fixedPlaylistId ? (
                    <PlaylistDisplay playlistId={fixedPlaylistId} />
                  ) : (
                    <div className="text-center text-gray-400">
                      No playlist configured. Please set up your playlist in your profile settings.
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Suspense>
      </div>
    </ProtectedRoute>
  )
} 