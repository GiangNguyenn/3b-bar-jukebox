'use client'

import { useState, useEffect } from 'react'
import { DJService, DJFrequency } from '@/services/djService'

const OPTIONS: { value: DJFrequency; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'rarely', label: 'Rarely' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'often', label: 'Often' },
  { value: 'always', label: 'Always' },
]

export function DJFrequencySelect(): JSX.Element {
  const [djEnabled, setDjEnabled] = useState(false)
  const [frequency, setFrequency] = useState<DJFrequency>('sometimes')

  useEffect(() => {
    const sync = (): void => {
      setDjEnabled(localStorage.getItem('djMode') === 'true')
      const stored = localStorage.getItem('djFrequency') as DJFrequency | null
      setFrequency(stored ?? 'sometimes')
    }
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('djmode-changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('djmode-changed', sync)
    }
  }, [])

  if (!djEnabled) {
    return null as unknown as JSX.Element
  }

  const handleSelect = (value: DJFrequency): void => {
    setFrequency(value)
    localStorage.setItem('djFrequency', value)
    DJService.getInstance().setFrequency(value)
  }

  return (
    <div className='py-1'>
      <span className='text-white text-sm font-semibold'>DJ Frequency</span>
      <div className='mt-1 flex gap-1 flex-wrap'>
        {OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type='button'
            onClick={() => handleSelect(value)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              frequency === value
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
