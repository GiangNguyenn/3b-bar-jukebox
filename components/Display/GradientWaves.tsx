'use client'

import { memo, useEffect, useState, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import type { SpotifyAudioFeatures } from '@/shared/types/spotify'

interface GradientWavesProps {
  audioFeatures?: SpotifyAudioFeatures | null
  colors: ColorPalette
  isPlaying: boolean
}

function GradientWaves({
  audioFeatures,
  colors,
  isPlaying
}: GradientWavesProps): ReactElement {
  const [phase, setPhase] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>()

  const energy = audioFeatures?.energy ?? 0.5
  const danceability = audioFeatures?.danceability ?? 0.5
  const tempo = audioFeatures?.tempo ?? 120

  useEffect(() => {
    if (!isPlaying || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = (canvas.width = window.innerWidth)
    const height = (canvas.height = window.innerHeight)

    let lastTime = Date.now()

    const animate = (): void => {
      const now = Date.now()
      const deltaTime = (now - lastTime) / 1000
      lastTime = now

      setPhase((prev): number => {
        const baseSpeed = tempo / 60
        const energySpeed = energy
        return prev + deltaTime * baseSpeed * energySpeed
      })

      // Clear canvas
      ctx.clearRect(0, 0, width, height)

      // Draw 5 gradient waves for stronger effect
      const waveCount = 5
      for (let i = 0; i < waveCount; i++) {
        const wavePhase = phase + i * 0.5
        const waveAmplitude = (40 + energy * 120) * (1 - i * 0.15)
        const waveFrequency = (0.03 + danceability * 0.05) * (1 + i * 0.25)
        const opacity = 0.2 + (i / waveCount) * 0.2

        // Top wave
        ctx.beginPath()
        ctx.moveTo(0, height / 2)
        for (let x = 0; x < width; x += 2) {
          const y =
            height / 2 - waveAmplitude * Math.sin(x * waveFrequency + wavePhase)
          ctx.lineTo(x, y)
        }
        ctx.lineTo(width, 0)
        ctx.lineTo(0, 0)
        ctx.closePath()

        const gradient = ctx.createLinearGradient(0, 0, 0, height / 2)
        gradient.addColorStop(0, colors.dominant + '80')
        gradient.addColorStop(1, colors.accent1 + '00')
        ctx.fillStyle = gradient
        ctx.globalAlpha = opacity
        ctx.fill()

        // Bottom wave
        ctx.beginPath()
        ctx.moveTo(0, height / 2)
        for (let x = 0; x < width; x += 2) {
          const y =
            height / 2 + waveAmplitude * Math.sin(x * waveFrequency + wavePhase)
          ctx.lineTo(x, y)
        }
        ctx.lineTo(width, height)
        ctx.lineTo(0, height)
        ctx.closePath()

        const gradientBottom = ctx.createLinearGradient(
          0,
          height / 2,
          0,
          height
        )
        gradientBottom.addColorStop(0, colors.accent2 + '80')
        gradientBottom.addColorStop(1, colors.background + '00')
        ctx.fillStyle = gradientBottom
        ctx.globalAlpha = opacity
        ctx.fill()
      }

      ctx.globalAlpha = 1
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    const handleResize = (): void => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    window.addEventListener('resize', handleResize)

    return (): void => {
      window.removeEventListener('resize', handleResize)
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current)
    }
  }, [isPlaying, energy, danceability, tempo, phase, colors])

  return (
    <canvas
      ref={canvasRef}
      className='absolute inset-0 h-full w-full'
      style={{ mixBlendMode: 'screen' }}
    />
  )
}

export default memo(GradientWaves)
