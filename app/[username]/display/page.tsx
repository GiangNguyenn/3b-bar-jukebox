'use client'

import { useParams } from 'next/navigation'
import { useRef, useEffect } from 'react'
import type { ReactElement } from 'react'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { useAlbumColors } from '@/hooks/useAlbumColors'
import { useAudioFeatures } from '@/hooks/useAudioFeatures'
import VisualizationContainer from '@/components/Display/VisualizationContainer'
import TrackMetadata from '@/components/Display/TrackMetadata'
import ColorBackground from '@/components/Display/ColorBackground'
import QRCodeComponent from '@/components/Display/QRCode'
import { Loading } from '@/components/ui'
import { ErrorMessage } from '@/components/ui'

export default function DisplayPage(): ReactElement {
  const params = useParams()
  const username = typeof params?.username === 'string' ? params.username : ''
  const hasInitialLoadRef = useRef(false)

  // Fetch currently playing track with optimized polling
  const {
    data: playbackState,
    error: playbackError,
    isLoading: isPlaybackLoading
  } = useNowPlayingTrack({
    token: null, // Use admin credentials for public display
    enabled: true,
    refetchInterval: 2000 // Poll every 2 seconds - still smooth but reduces API calls by 50%
  })

  // Extract track values with proper dependency management
  const trackItem = playbackState?.item
  const albumArtUrl = trackItem?.album?.images?.[0]?.url
  const trackId = trackItem?.id ?? null
  const trackName = trackItem?.name ?? ''
  const artistName = trackItem?.artists?.[0]?.name ?? ''
  const albumName = trackItem?.album?.name ?? ''
  const isPlaying = playbackState?.is_playing ?? false

  const { colors, isLoading: isColorsLoading, error: colorsError } =
    useAlbumColors(albumArtUrl)

  // Get audio features for the current track (hook already handles trackId changes)
  const { features: audioFeatures, error: audioFeaturesError } =
    useAudioFeatures(trackId)

  // Track when initial load completes - when isLoading transitions from true to false
  // This means we've received at least one response (data, null from 204, or error)
  useEffect(() => {
    if (!isPlaybackLoading && !hasInitialLoadRef.current) {
      hasInitialLoadRef.current = true
    }
  }, [isPlaybackLoading])

  // Combine error states
  const hasError = Boolean(
    playbackError || colorsError || audioFeaturesError
  )

  // Only show loading on initial load (before first response completes)
  // After initial load completes, never show loading screen even during background polling
  const isInitialLoading = !hasInitialLoadRef.current && isPlaybackLoading

  // Loading state - only show on initial load
  if (isInitialLoading) {
    return (
      <>
        <Loading fullScreen message='Loading display...' />
        {username && <QRCodeComponent username={username} />}
      </>
    )
  }

  // Error state
  if (hasError) {
    return (
      <>
        <div className='relative min-h-screen overflow-hidden bg-black'>
          <div className='relative z-10 flex min-h-screen items-center justify-center'>
            <ErrorMessage
              message='Unable to load display data'
              error={
                playbackError ||
                colorsError ||
                audioFeaturesError ||
                new Error('Unknown error')
              }
            />
          </div>
        </div>
        {username && <QRCodeComponent username={username} />}
      </>
    )
  }

  // No track playing
  if (!trackItem) {
    return (
      <>
        <div className='relative min-h-screen overflow-hidden'>
          <ColorBackground colors={colors} isPlaying={false} />
          <div className='relative z-10 flex min-h-screen items-center justify-center'>
            <div className='text-center'>
              <div className='mb-8 text-8xl' style={{ color: colors.dominant }}>
                🎵
              </div>
              <div
                className='text-4xl font-bold'
                style={{ color: colors.foreground }}
              >
                No track playing
              </div>
              <div
                className='mt-4 text-xl opacity-60'
                style={{ color: colors.foreground }}
              >
                Start playing a track to see the visualization
              </div>
            </div>
          </div>
        </div>
        {username && <QRCodeComponent username={username} />}
      </>
    )
  }

  // Track is playing - show full display
  if (!albumArtUrl) {
    return (
      <>
        <div className='relative min-h-screen overflow-hidden'>
          <ColorBackground colors={colors} isPlaying={isPlaying} />
          <div className='relative z-10 flex min-h-screen items-center justify-center'>
            <ErrorMessage message='Unable to load track artwork' />
          </div>
        </div>
        {username && <QRCodeComponent username={username} />}
      </>
    )
  }

  return (
    <>
      <div className='relative min-h-screen overflow-hidden'>
        {/* Dynamic background with extracted colors */}
        <ColorBackground colors={colors} isPlaying={isPlaying} />

        {/* Main content */}
        <div className='relative z-10 flex min-h-screen flex-col overflow-hidden'>
          {/* Top section with metadata */}
          <div className='relative z-40 px-4 pt-4 sm:px-6 sm:pt-6 md:px-8 md:pt-8'>
            <TrackMetadata
              trackName={trackName}
              artistName={artistName}
              albumName={albumName}
              albumArtUrl={albumArtUrl}
              explicit={false}
              colors={colors}
            />
          </div>

          {/* Multi-layered Visualization - takes up entire screen */}
          <div className='absolute inset-0'>
            <VisualizationContainer
              audioFeatures={audioFeatures}
              colors={colors}
              isPlaying={isPlaying}
            />
          </div>
        </div>
      </div>
      {username && <QRCodeComponent username={username} />}
    </>
  )
}
