'use client'

import { memo, useEffect, useState, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import type { SpotifyAudioFeatures } from '@/shared/types/spotify'

interface WaveformVisualizerProps {
  progress: number // 0-100
  isPlaying: boolean
  colors: ColorPalette
  barCount?: number
  audioFeatures?: SpotifyAudioFeatures | null
}

function WaveformVisualizer({
  progress,
  isPlaying,
  colors,
  barCount = 50,
  audioFeatures
}: WaveformVisualizerProps): ReactElement {
  const [barHeights, setBarHeights] = useState<number[]>([])
  const [animationFrame, setAnimationFrame] = useState(0)
  const lastProgressRef = useRef(0)

  useEffect(() => {
    // Generate base waveform pattern
    const heights: number[] = []

    if (audioFeatures) {
      // Use real audio features!
      const energy = audioFeatures.energy // 0-1
      const danceability = audioFeatures.danceability // 0-1
      const loudness = audioFeatures.loudness // dB, typically -60 to 0

      for (let i = 0; i < barCount; i++) {
        const frequencyBand = i / barCount
        let baseHeight: number

        // Scale energy to bar heights (energy * 50 = max height multiplier)
        const energyMultiplier = energy * 50
        const loudnessScale = Math.max((loudness + 60) / 60, 0.3) // Normalize -60dB to 0dB as 0-1

        // Simulate frequency response curve based on actual energy
        if (frequencyBand < 0.2) {
          // Sub bass
          baseHeight =
            15 +
            Math.sin(frequencyBand * Math.PI * 5) *
              energyMultiplier *
              0.8 *
              loudnessScale
        } else if (frequencyBand < 0.4) {
          // Bass
          baseHeight =
            25 +
            Math.sin(frequencyBand * Math.PI * 3) *
              energyMultiplier *
              1.2 *
              loudnessScale
        } else if (frequencyBand < 0.6) {
          // Mids (peak energy)
          baseHeight =
            30 +
            Math.sin(frequencyBand * Math.PI * 4) *
              energyMultiplier *
              1.5 *
              loudnessScale
        } else if (frequencyBand < 0.8) {
          // High mids
          baseHeight =
            25 +
            Math.sin(frequencyBand * Math.PI * 5) *
              energyMultiplier *
              1.3 *
              loudnessScale
        } else {
          // Highs
          baseHeight =
            15 +
            Math.sin(frequencyBand * Math.PI * 6) *
              energyMultiplier *
              loudnessScale
        }

        // Add danceability influence to create more dynamic variation
        baseHeight += danceability * 20

        heights.push(baseHeight)
      }
    } else {
      // Fallback to simulated pattern when features aren't loaded
      for (let i = 0; i < barCount; i++) {
        const frequencyBand = i / barCount
        let baseHeight: number

        if (frequencyBand < 0.2) {
          baseHeight = 20 + Math.sin(frequencyBand * Math.PI * 5) * 10
        } else if (frequencyBand < 0.4) {
          baseHeight = 35 + Math.sin(frequencyBand * Math.PI * 3) * 20
        } else if (frequencyBand < 0.6) {
          baseHeight = 40 + Math.sin(frequencyBand * Math.PI * 4) * 25
        } else if (frequencyBand < 0.8) {
          baseHeight = 35 + Math.sin(frequencyBand * Math.PI * 5) * 20
        } else {
          baseHeight = 25 + Math.sin(frequencyBand * Math.PI * 6) * 15
        }

        heights.push(baseHeight)
      }
    }

    setBarHeights(heights)
  }, [barCount, audioFeatures])

  // Continuous animation that responds to playback
  useEffect(() => {
    if (!isPlaying) return

    let frame: number

    const animate = (): void => {
      // Update based on time delta to create responsive animation
      setAnimationFrame((prev) => {
        // Add variation based on progress changes
        const progressDelta = progress - lastProgressRef.current
        lastProgressRef.current = progress

        return prev + 1 + Math.abs(progressDelta) * 10
      })

      frame = requestAnimationFrame(animate)
    }

    frame = requestAnimationFrame(animate)

    return (): void => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [isPlaying, progress])

  return (
    <div className='flex h-full w-full items-center justify-center gap-0 sm:gap-0.5'>
      {barHeights.map((height, i) => {
        // Create dynamic, responsive animation based on multiple factors
        const timeVariation = isPlaying
          ? Math.sin((i / barCount) * Math.PI * 6 + animationFrame * 0.04) * 25
          : 0

        const positionVariation =
          Math.sin((i / barCount) * Math.PI * 4 + Date.now() / 100) * 15

        // Add random element for organic feel
        const randomVariation = isPlaying ? (Math.random() - 0.5) * 20 : 0

        const combinedVariation =
          timeVariation + positionVariation + randomVariation
        const barHeight = Math.max(height + combinedVariation, 10)

        // Create wave-like pulsing based on position and time
        const pulse = Math.sin(
          (i / barCount) * Math.PI * 2 + animationFrame * 0.05
        )

        return (
          <div
            key={i}
            className='flex items-center justify-center'
            style={{
              width: `${100 / barCount}%`,
              minWidth: '2px',
              height: '100%',
              transition: 'transform 0.1s ease-out'
            }}
          >
            <div
              className='w-full transition-all duration-100 ease-out'
              style={{
                height: `${barHeight}%`,
                minHeight: '40px',
                background: `linear-gradient(to top, ${colors.background}20, ${colors.dominant}, ${colors.accent1})`,
                borderRadius: '2px 2px 4px 4px',
                opacity:
                  0.6 + Math.min(barHeight / 150, 0.4) + Math.abs(pulse) * 0.1,
                boxShadow: `
                  0 0 ${barHeight / 3}px ${colors.dominant}aa,
                  0 0 ${barHeight / 2}px ${colors.accent1}88,
                  inset 0 0 20px ${colors.dominant}33
                `,
                transform: `scaleY(${1 + Math.min(barHeight / 100, 0.5)}) translateY(${pulse * 2}px)`
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

export default memo(WaveformVisualizer)
