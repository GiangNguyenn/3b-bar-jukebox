'use client'

import { useParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import QRCode from 'qrcode'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { useAlbumColors } from '@/hooks/useAlbumColors'
import { useAudioFeatures } from '@/hooks/useAudioFeatures'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import VisualizationContainer from '@/components/Display/VisualizationContainer'
import TrackMetadata from '@/components/Display/TrackMetadata'
import ColorBackground from '@/components/Display/ColorBackground'
import { Loading } from '@/components/ui'

export default function DisplayPage(): ReactElement {
  const params = useParams()
  const username = params?.username as string | undefined
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { addLog } = useConsoleLogsContext()

  // Generate QR code for playlist page
  useEffect(() => {
    if (!username) return

    const playlistUrl = `${window.location.origin}/${username}/playlist`

    const generateQRCode = async (): Promise<void> => {
      if (!canvasRef.current) {
        addLog('LOG', 'Waiting for canvas ref...', 'DisplayPage')
        setTimeout(() => {
          void generateQRCode()
        }, 100)
        return
      }

      try {
        addLog('LOG', `Generating QR code for: ${playlistUrl}`, 'DisplayPage')
        const canvas = canvasRef.current
        await QRCode.toCanvas(canvas, playlistUrl, {
          width: 120,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        })
        addLog('LOG', 'QR code generated successfully', 'DisplayPage')
      } catch (err) {
        addLog(
          'ERROR',
          'Failed to generate QR code',
          'DisplayPage',
          err as Error
        )
      }
    }

    // Retry generation with delay to ensure canvas is mounted
    const timer = setTimeout(() => {
      void generateQRCode()
    }, 500)

    return (): void => clearTimeout(timer)
  }, [username, addLog])

  // Fetch currently playing track with high-frequency polling
  const { data: playbackState } = useNowPlayingTrack({
    token: null, // Use admin credentials for public display
    enabled: true,
    refetchInterval: 1000 // Poll every second for smooth animations
  })

  // Extract album artwork URL
  const albumArtUrl = playbackState?.item?.album?.images?.[0]?.url
  const { colors, isLoading: isColorsLoading } = useAlbumColors(albumArtUrl)

  // Get audio features for the current track
  const trackId = playbackState?.item?.id
  const { features: audioFeatures } = useAudioFeatures(trackId ?? null)

  // Track change detection for animations
  const trackName = playbackState?.item?.name ?? ''
  const artistName = playbackState?.item?.artists?.[0]?.name ?? ''
  const albumName = playbackState?.item?.album?.name ?? ''
  const isPlaying = playbackState?.is_playing ?? false

  // Render QR code in all states
  const qrCodeElement = (
    <div className='fixed right-4 top-4 z-[100]'>
      <div className='bg-white rounded-lg p-3 shadow-2xl'>
        <canvas
          ref={canvasRef}
          width={120}
          height={120}
          className='bg-white block'
        />
      </div>
    </div>
  )

  // Loading state
  if (isColorsLoading || !playbackState) {
    return (
      <>
        <Loading fullScreen message='Loading display...' />
        {qrCodeElement}
      </>
    )
  }

  // No track playing
  if (!playbackState.item) {
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
        {qrCodeElement}
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
              albumArtUrl={albumArtUrl!}
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
      {qrCodeElement}
    </>
  )
}
