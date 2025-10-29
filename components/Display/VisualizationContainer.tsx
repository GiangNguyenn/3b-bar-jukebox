'use client'

import { memo } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import type { SpotifyAudioFeatures } from '@/shared/types/spotify'
import GradientWaves from './GradientWaves'
import LinearSpectrum from './LinearSpectrum'

interface VisualizationContainerProps {
  audioFeatures?: SpotifyAudioFeatures | null
  colors: ColorPalette
  isPlaying: boolean
}

function VisualizationContainer({
  audioFeatures,
  colors,
  isPlaying
}: VisualizationContainerProps): ReactElement {
  return (
    <div
      className='absolute inset-0 overflow-hidden'
      style={{ perspective: '1000px' }}
    >
      {/* Background layer - Gradient Waves */}
      <div className='absolute inset-0 z-10' style={{ opacity: 0.6 }}>
        <GradientWaves
          audioFeatures={audioFeatures}
          colors={colors}
          isPlaying={isPlaying}
        />
      </div>

      {/* Linear Spectrum layer - bottom */}
      <div className='absolute inset-0 z-[25]' style={{ opacity: 0.8 }}>
        <LinearSpectrum
          audioFeatures={audioFeatures}
          colors={colors}
          isPlaying={isPlaying}
        />
      </div>
    </div>
  )
}

function arePropsEqual(
  prev: VisualizationContainerProps,
  next: VisualizationContainerProps
): boolean {
  // Compare primitive values
  if (prev.isPlaying !== next.isPlaying) return false

  // Compare audioFeatures - check if both are null/undefined or have same id
  const prevAudioFeaturesId = prev.audioFeatures?.id ?? null
  const nextAudioFeaturesId = next.audioFeatures?.id ?? null
  if (prevAudioFeaturesId !== nextAudioFeaturesId) return false

  // Compare colors object by checking all properties
  if (
    prev.colors.dominant !== next.colors.dominant ||
    prev.colors.accent1 !== next.colors.accent1 ||
    prev.colors.accent2 !== next.colors.accent2 ||
    prev.colors.background !== next.colors.background ||
    prev.colors.foreground !== next.colors.foreground
  ) {
    return false
  }

  return true
}

export default memo(VisualizationContainer, arePropsEqual)
