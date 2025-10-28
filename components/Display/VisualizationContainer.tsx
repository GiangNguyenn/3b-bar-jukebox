'use client'

import { memo } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import type { SpotifyAudioFeatures } from '@/shared/types/spotify'
import GradientWaves from './GradientWaves'
import PulsingRings from './PulsingRings'
import LinearSpectrum from './LinearSpectrum'
import ParticleSystem from './ParticleSystem'

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

      {/* Pulsing Rings layer */}
      <div className='z-15 absolute inset-0' style={{ opacity: 0.7 }}>
        <PulsingRings
          audioFeatures={audioFeatures}
          colors={colors}
          isPlaying={isPlaying}
        />
      </div>

      {/* Linear Spectrum layer - bottom */}
      <div className='z-25 absolute inset-0' style={{ opacity: 0.8 }}>
        <LinearSpectrum
          audioFeatures={audioFeatures}
          colors={colors}
          isPlaying={isPlaying}
        />
      </div>

      {/* Foreground layer - Particle System */}
      <div
        className='absolute inset-0 z-30'
        style={{
          transform: audioFeatures?.loudness
            ? `translateZ(${(audioFeatures.loudness + 60) * 2}px) scale(1.1)`
            : 'translateZ(0) scale(1.1)',
          filter: 'contrast(1.2) saturate(1.3)'
        }}
      >
        <ParticleSystem
          audioFeatures={audioFeatures}
          colors={colors}
          isPlaying={isPlaying}
        />
      </div>
    </div>
  )
}

export default memo(VisualizationContainer)
