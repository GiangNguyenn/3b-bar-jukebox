'use client'

import { memo, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import type { SpotifyAudioFeatures } from '@/shared/types/spotify'

interface CircularSpectrumProps {
  audioFeatures?: SpotifyAudioFeatures | null
  colors: ColorPalette
  isPlaying: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  opacity: number
  life: number
}

function ParticleSystem({
  audioFeatures,
  colors,
  isPlaying
}: CircularSpectrumProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])

  const energy = audioFeatures?.energy ?? 0.5
  const danceability = audioFeatures?.danceability ?? 0.5
  const valence = audioFeatures?.valence ?? 0.5
  const loudness = audioFeatures?.loudness ?? -20

  // Particle count based on energy - increased for more dramatic effect
  const particleCount = Math.floor(100 + energy * 200)
  const particleSize = Math.max(3 + (loudness + 60) / 12, 2.5)

  useEffect(() => {
    if (!isPlaying) {
      particlesRef.current = []
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Initialize particles
    if (particlesRef.current.length === 0) {
      particlesRef.current = Array.from({ length: particleCount }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * (2 + danceability * 4),
        vy: (Math.random() - 0.5) * (2 + danceability * 4),
        size: particleSize,
        color: Math.random() > 0.5 ? colors.dominant : colors.accent1,
        opacity: 0.3 + Math.random() * 0.5,
        life: Math.random()
      }))
    }

    let animationFrame: number

    const animate = (): void => {
      if (!ctx) return

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Update and draw particles
      particlesRef.current.forEach((particle) => {
        // Update position
        particle.x += particle.vx
        particle.y += particle.vy

        // Wrap around edges
        if (particle.x < 0) particle.x = canvas.width
        if (particle.x > canvas.width) particle.x = 0
        if (particle.y < 0) particle.y = canvas.height
        if (particle.y > canvas.height) particle.y = 0

        // Update life for pulsing
        particle.life += 0.02 + danceability * 0.04

        // Calculate pulsing opacity - more dramatic
        const pulseOpacity =
          0.5 +
          Math.sin(particle.life) *
            (valence * 0.7) *
            (0.8 + Math.random() * 0.2)

        // Draw particle with glow
        ctx.shadowBlur = particle.size * 3 + valence * 15
        ctx.shadowColor = particle.color
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        ctx.fillStyle = particle.color
        ctx.globalAlpha = particle.opacity * pulseOpacity
        ctx.fill()
        ctx.fill() // Draw twice for stronger glow

        // Reset shadow
        ctx.shadowBlur = 0
      })

      animationFrame = requestAnimationFrame(animate)
    }

    // Set canvas size
    const resizeCanvas = (): void => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    animate()

    return (): void => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationFrame) cancelAnimationFrame(animationFrame)
    }
  }, [
    isPlaying,
    particleCount,
    energy,
    danceability,
    valence,
    particleSize,
    colors,
    audioFeatures
  ])

  return (
    <canvas
      ref={canvasRef}
      className='pointer-events-none absolute inset-0 h-full w-full'
      style={{ mixBlendMode: 'screen' }}
    />
  )
}

export default memo(ParticleSystem)
