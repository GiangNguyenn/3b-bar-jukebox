'use client'

import { memo } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import GradientWaves from './GradientWaves'
import LinearSpectrum from './LinearSpectrum'

interface VisualizationContainerProps {
  colors: ColorPalette
  isPlaying: boolean
}

function VisualizationContainer({
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
        <GradientWaves colors={colors} isPlaying={isPlaying} />
      </div>

      {/* Linear Spectrum layer - bottom */}
      <div className='absolute inset-0 z-[25]' style={{ opacity: 0.8 }}>
        <LinearSpectrum colors={colors} isPlaying={isPlaying} />
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
