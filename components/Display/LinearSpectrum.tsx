'use client'

import { memo, useEffect, useRef, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import type { SpotifyAudioFeatures } from '@/shared/types/spotify'

interface LinearSpectrumProps {
  audioFeatures?: SpotifyAudioFeatures | null
  colors: ColorPalette
  isPlaying: boolean
}

const BAR_COUNT = 50
const BAR_GAP = 2

function LinearSpectrum({
  audioFeatures,
  colors,
  isPlaying
}: LinearSpectrumProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>()
  const timeRef = useRef(0)

  const energy = audioFeatures?.energy ?? 0.5
  const loudness = audioFeatures?.loudness ?? -20

  // Generate base bar heights based on frequency bands - memoized calculation
  const barHeights = useMemo(() => {
    const heights: number[] = []

    for (let i = 0; i < BAR_COUNT; i++) {
      const frequencyBand = i / BAR_COUNT
      let height: number

      if (frequencyBand < 0.2) {
        // Sub bass
        height = 30 + Math.sin(frequencyBand * Math.PI * 5) * 20
      } else if (frequencyBand < 0.4) {
        // Bass
        height = 50 + Math.sin(frequencyBand * Math.PI * 3) * 40
      } else if (frequencyBand < 0.6) {
        // Mids
        height = 60 + Math.sin(frequencyBand * Math.PI * 4) * 50
      } else if (frequencyBand < 0.8) {
        // High mids
        height = 50 + Math.sin(frequencyBand * Math.PI * 5) * 40
      } else {
        // Highs
        height = 35 + Math.sin(frequencyBand * Math.PI * 6) * 30
      }

      heights.push(height)
    }

    return heights
  }, [])

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = (): void => {
      canvas.width = window.innerWidth
      canvas.height = Math.min(window.innerHeight * 0.4, 300) // Max 300px height
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const draw = (): void => {
      if (!isPlaying) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const barWidth = canvas.width / BAR_COUNT
      const loudnessScale = Math.max((loudness + 60) / 60, 0.3)
      const maxBarHeight = canvas.height * 0.8

      timeRef.current += 0.05

      barHeights.forEach((height, i) => {
        // Add animation variation
        const timeVariation =
          Math.sin((i / BAR_COUNT) * Math.PI * 6 + timeRef.current) * 20

        const randomVariation = (Math.random() - 0.5) * 15
        const heightVariation = timeVariation + randomVariation

        const barHeight =
          (height * loudnessScale + heightVariation) * (energy * 1.5 + 0.5)
        const scaledHeight = Math.max((barHeight / 100) * maxBarHeight, 10)
        const x = i * barWidth

        // Create gradient for each bar
        const gradient = ctx.createLinearGradient(
          x,
          canvas.height - scaledHeight,
          x,
          canvas.height
        )
        gradient.addColorStop(0, colors.dominant)
        gradient.addColorStop(1, colors.accent1)

        ctx.fillStyle = gradient
        ctx.shadowBlur = 10
        ctx.shadowColor = colors.accent1

        ctx.fillRect(
          x + BAR_GAP,
          canvas.height - scaledHeight,
          barWidth - BAR_GAP * 2,
          scaledHeight
        )

        // Reset shadow
        ctx.shadowBlur = 0
      })

      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(draw)
      }
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(draw)
    }

    return (): void => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current)
    }
  }, [isPlaying, energy, loudness, colors, barHeights])

  return (
    <canvas
      ref={canvasRef}
      className='pointer-events-none absolute bottom-0 left-0 w-full'
      style={{ mixBlendMode: 'screen' }}
    />
  )
}

export default memo(LinearSpectrum)
