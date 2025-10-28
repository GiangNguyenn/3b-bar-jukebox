'use client'

import { memo, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import type { SpotifyAudioFeatures } from '@/shared/types/spotify'

interface PulsingRingsProps {
  audioFeatures?: SpotifyAudioFeatures | null
  colors: ColorPalette
  isPlaying: boolean
}

interface Ring {
  x: number
  y: number
  radius: number
  maxRadius: number
  opacity: number
  color: string
  thickness: number
}

function PulsingRings({
  audioFeatures,
  colors,
  isPlaying
}: PulsingRingsProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ringsRef = useRef<Ring[]>([])

  const energy = audioFeatures?.energy ?? 0.5
  const loudness = audioFeatures?.loudness ?? -20
  const tempo = audioFeatures?.tempo ?? 120
  const valence = audioFeatures?.valence ?? 0.5

  // Spawn rate based on energy
  const spawnChance = energy * 0.03
  const expansionSpeed = tempo / 1000 // pixels per ms
  const fadeSpeed = 0.003

  useEffect(() => {
    if (!isPlaying || !canvasRef.current) {
      ringsRef.current = []
      return
    }

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = (): void => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    let lastSpawnTime = 0

    const animate = (): void => {
      if (!ctx) return

      // Spawn new rings based on energy
      const now = Date.now()
      if (energy > 0.5 && now - lastSpawnTime > 500) {
        if (Math.random() < spawnChance) {
          ringsRef.current.push({
            x: centerX,
            y: centerY,
            radius: 50,
            maxRadius: 300 + energy * 200,
            opacity: 0.6 + valence * 0.2,
            color: energy > 0.7 ? colors.accent1 : colors.dominant,
            thickness: 2 + energy * 2
          })
          lastSpawnTime = now
        }
      }

      // Update and render rings
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      ringsRef.current = ringsRef.current.filter((ring) => {
        ring.radius += expansionSpeed * 16 // ~60fps
        ring.opacity -= fadeSpeed
        return ring.opacity > 0 && ring.radius < ring.maxRadius
      })

      ringsRef.current.forEach((ring) => {
        ctx.beginPath()
        ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2)
        ctx.strokeStyle = ring.color
        ctx.globalAlpha = ring.opacity
        ctx.lineWidth = ring.thickness
        ctx.stroke()

        // Outer glow
        ctx.shadowBlur = 20
        ctx.shadowColor = ring.color
        ctx.stroke()
        ctx.shadowBlur = 0
      })

      ctx.globalAlpha = 1
    }

    const animationFrame = requestAnimationFrame(function loop(): void {
      animate()
      requestAnimationFrame(loop)
    })

    return (): void => {
      window.removeEventListener('resize', resizeCanvas)
      cancelAnimationFrame(animationFrame)
    }
  }, [
    isPlaying,
    energy,
    loudness,
    tempo,
    valence,
    colors,
    spawnChance,
    expansionSpeed,
    fadeSpeed
  ])

  return (
    <canvas
      ref={canvasRef}
      className='pointer-events-none absolute inset-0 h-full w-full'
      style={{ mixBlendMode: 'screen' }}
    />
  )
}

export default memo(PulsingRings)
