'use client'

import { memo, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'

interface ColorBackgroundProps {
  colors: ColorPalette
  isPlaying: boolean
}

function ColorBackground({
  colors,
  isPlaying
}: ColorBackgroundProps): ReactElement {
  const [particles, setParticles] = useState<
    Array<{
      x: number
      y: number
      vx: number
      vy: number
      size: number
      color: string
    }>
  >([])

  useEffect(() => {
    // Generate floating particles
    const newParticles = Array.from(
      { length: 20 },
      (): {
        x: number
        y: number
        vx: number
        vy: number
        size: number
        color: string
      } => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 50 + 20,
        color: Math.random() > 0.5 ? colors.dominant : colors.accent1
      })
    )
    setParticles(newParticles)
  }, [colors])

  useEffect(() => {
    if (!isPlaying) return

    const interval = setInterval((): void => {
      setParticles((prev) =>
        prev.map((p) => ({
          ...p,
          x: (p.x + p.vx + 100) % 100,
          y: (p.y + p.vy + 100) % 100
        }))
      )
    }, 50)

    return (): void => clearInterval(interval)
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
            key={i}
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
