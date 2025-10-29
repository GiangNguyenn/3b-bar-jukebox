'use client'

import { memo, useEffect, useState, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'

interface Particle {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
}

interface ColorBackgroundProps {
  colors: ColorPalette
  isPlaying: boolean
}

function ColorBackground({
  colors,
  isPlaying
}: ColorBackgroundProps): ReactElement {
  const [particles, setParticles] = useState<Particle[]>([])
  const animationFrameRef = useRef<number | undefined>()

  useEffect(() => {
    // Generate floating particles with unique IDs
    const newParticles: Particle[] = Array.from({ length: 20 }, (_, i) => ({
      id: `particle-${i}-${Date.now()}-${Math.random()}`,
      x: Math.random() * 100,
      y: Math.random() * 100,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      size: Math.random() * 50 + 20,
      color: Math.random() > 0.5 ? colors.dominant : colors.accent1
    }))
    setParticles(newParticles)
  }, [colors])

  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = undefined
      }
      return
    }

    const animate = (): void => {
      setParticles((prev) =>
        prev.map((p) => ({
          ...p,
          x: (p.x + p.vx + 100) % 100,
          y: (p.y + p.vy + 100) % 100
        }))
      )
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return (): void => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = undefined
      }
    }
  }, [isPlaying])

  return (
    <>
      {/* Animated gradient background */}
      <div
        className='fixed inset-0 -z-20 transition-all duration-1000'
        style={{
          background: `radial-gradient(circle at 30% 50%, ${colors.dominant}40 0%, transparent 50%),
                        radial-gradient(circle at 70% 80%, ${colors.accent1}40 0%, transparent 50%),
                        linear-gradient(135deg, ${colors.background}, ${colors.accent2}20)`
        }}
      />

      {/* Floating particles */}
      <div
        className={`fixed inset-0 -z-10 ${isPlaying ? 'animate-pulse' : ''}`}
      >
        {particles.map((particle, i) => (
          <div
            key={particle.id}
            className='absolute rounded-full opacity-30 blur-md'
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              width: particle.size,
              height: particle.size,
              backgroundColor: particle.color,
              transition: 'all 0.05s ease-out',
              animation: 'float 4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`
            }}
          />
        ))}
      </div>

      {/* Overlay for depth */}
      <div
        className='-z-15 fixed inset-0 bg-gradient-to-b from-transparent via-transparent to-black/40'
        style={{ backgroundBlendMode: 'multiply' }}
      />
    </>
  )
}

export default memo(ColorBackground)
