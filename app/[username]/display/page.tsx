'use client'

import { useParams } from 'next/navigation'
import { useRef, useEffect } from 'react'
import type { ReactElement } from 'react'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { useAlbumColors } from '@/hooks/useAlbumColors'

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
    refetchInterval: 15000 // Poll every 15 seconds - reduces API calls significantly while maintaining smooth UX
  })

  // Extract track values with proper dependency management
  const trackItem = playbackState?.item
  const albumArtUrl = trackItem?.album?.images?.[0]?.url
  const trackName = trackItem?.name ?? ''
  const artistName = trackItem?.artists?.[0]?.name ?? ''
  const albumName = trackItem?.album?.name ?? ''
  const isPlaying = playbackState?.is_playing ?? false

  const { colors, error: colorsError } = useAlbumColors(albumArtUrl)

  // Get audio features - feature removed due to API deprecation
  // const { features: audioFeatures } = useAudioFeatures(trackId)

  // Preload album art image for faster loading
  useEffect(() => {
    if (!albumArtUrl) return

    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = albumArtUrl
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)

    return (): void => {
      document.head.removeChild(link)
    }
  }, [albumArtUrl])

  // Track when initial load completes - when isLoading transitions from true to false
  // This means we've received at least one response (data, null from 204, or error)
  useEffect(() => {
    if (!isPlaybackLoading && !hasInitialLoadRef.current) {
      hasInitialLoadRef.current = true
    }
  }, [isPlaybackLoading])

  // Combine error states (audio features are optional, so don't treat their errors as critical)
  const hasError = Boolean(playbackError ?? colorsError)

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
            <ErrorMessage message='Unable to load display data' />
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
  return (
    <>
      <div className='relative min-h-screen overflow-hidden'>
        {/* Dynamic background with extracted colors */}
        <ColorBackground colors={colors} isPlaying={isPlaying} />

        {/* Main content */}
        <div className='relative z-10 flex min-h-screen flex-col overflow-hidden'>
          {/* Top section with metadata */}
          <div className='relative z-40 px-4 pr-72 pt-4 sm:px-6 sm:pr-80 sm:pt-6 md:px-8 md:pr-96 md:pt-8'>
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
              audioFeatures={undefined}
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
