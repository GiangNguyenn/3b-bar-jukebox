'use client'

import type { ReactElement } from 'react'

interface VinylRecordPlaceholderProps {
  className?: string
  size?: number
}

export default function VinylRecordPlaceholder({
  className = '',
  size = 512
}: VinylRecordPlaceholderProps): ReactElement {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="animate-spinSlow"
      >
        {/* Outer vinyl record circle */}
        <circle
          cx="256"
          cy="256"
          r="250"
          fill="url(#vinylGradient)"
          stroke="#000"
          strokeWidth="2"
        />

        {/* Grooves - multiple concentric circles */}
        {Array.from({ length: 40 }, (_, i) => {
          const radius = 240 - i * 5
          return (
            <circle
              key={i}
              cx="256"
              cy="256"
              r={radius}
              fill="none"
              stroke="rgba(0, 0, 0, 0.1)"
              strokeWidth="0.5"
            />
          )
        })}

        {/* Label area */}
        <circle cx="256" cy="256" r="80" fill="#1a1a1a" />
        <circle cx="256" cy="256" r="78" fill="url(#labelGradient)" />

        {/* Label text circle */}
        <circle
          cx="256"
          cy="256"
          r="65"
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth="1"
        />

        {/* Center hole */}
        <circle cx="256" cy="256" r="20" fill="#000" />
        <circle cx="256" cy="256" r="18" fill="url(#holeGradient)" />

        {/* Music note icon in the label */}
        <g transform="translate(256, 256)">
          <path
            d="M-15 -20 L-15 15 M-15 -20 L10 -25 L10 10 M-20 15 A5 5 0 1 0 -10 15 A5 5 0 1 0 -20 15 M5 10 A5 5 0 1 0 15 10 A5 5 0 1 0 5 10"
            fill="#fff"
            opacity="0.3"
          />
        </g>

        {/* Gradients */}
        <defs>
          <radialGradient id="vinylGradient">
            <stop offset="0%" stopColor="#1a1a1a" />
            <stop offset="50%" stopColor="#0a0a0a" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>

          <radialGradient id="labelGradient">
            <stop offset="0%" stopColor="#2a2a2a" />
            <stop offset="100%" stopColor="#1a1a1a" />
          </radialGradient>

          <radialGradient id="holeGradient">
            <stop offset="0%" stopColor="#333" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  )
}

