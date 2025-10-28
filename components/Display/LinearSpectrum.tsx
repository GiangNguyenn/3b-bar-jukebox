'use client'

import { memo, useEffect, useState, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import type { SpotifyAudioFeatures } from '@/shared/types/spotify'

interface LinearSpectrumProps {
  audioFeatures?: SpotifyAudioFeatures | null
  colors: ColorPalette
  isPlaying: boolean
}

function LinearSpectrum({
  audioFeatures,
  colors,
  isPlaying
}: LinearSpectrumProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [animationFrame, setAnimationFrame] = useState(0)
  const [barHeights, setBarHeights] = useState<number[]>([])

  const energy = audioFeatures?.energy ?? 0.5
  const loudness = audioFeatures?.loudness ?? -20

  const barCount = 50
  const barGap = 2

  useEffect(() => {
    // Generate base bar heights based on frequency bands
    const heights: number[] = []

    for (let i = 0; i < barCount; i++) {
      const frequencyBand = i / barCount
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

    setBarHeights(heights)
  }, [barCount])

  useEffect(() => {
    if (!isPlaying) return

    const animate = (): void => {
      setAnimationFrame((prev) => prev + 1)
    }

    const animationId = requestAnimationFrame(function loop(): void {
      animate()
      requestAnimationFrame(loop)
    })

    return (): void => cancelAnimationFrame(animationId)
  }, [isPlaying])

  useEffect(() => {
    if (!canvasRef.current || barHeights.length === 0) return

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
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const barWidth = canvas.width / barCount
      const loudnessScale = Math.max((loudness + 60) / 60, 0.3)
      const maxBarHeight = canvas.height * 0.8

      barHeights.forEach((height, i) => {
        // Add animation variation
        const timeVariation = isPlaying
          ? Math.sin((i / barCount) * Math.PI * 6 + animationFrame * 0.05) * 20
          : 0

        const randomVariation = isPlaying ? (Math.random() - 0.5) * 15 : 0
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
          x + barGap,
          canvas.height - scaledHeight,
          barWidth - barGap * 2,
          scaledHeight
        )

        // Reset shadow
        ctx.shadowBlur = 0
      })

      if (isPlaying) {
        requestAnimationFrame(draw)
      }
    }

    draw()

    return (): void => {
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [isPlaying, barHeights, energy, loudness, colors, animationFrame])

  return (
    <canvas
      ref={canvasRef}
      className='pointer-events-none absolute bottom-0 left-0 w-full'
      style={{ mixBlendMode: 'screen' }}
    />
  )
}

export default memo(LinearSpectrum)
