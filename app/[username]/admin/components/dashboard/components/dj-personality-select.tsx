'use client'

import { useState, useEffect } from 'react'
import { DJService } from '@/services/djService'
import {
  DJ_PERSONALITIES,
  DJ_PERSONALITY_IDS,
  DEFAULT_DJ_PERSONALITY
} from '@/shared/constants/djPersonalities'

export function DJPersonalitySelect(): JSX.Element {
  const [djEnabled, setDjEnabled] = useState(false)
  const [language, setLanguage] = useState('english')
  const [personality, setPersonality] = useState(DEFAULT_DJ_PERSONALITY)

  useEffect(() => {
    const sync = (): void => {
      setDjEnabled(localStorage.getItem('djMode') === 'true')
      const storedLang = localStorage.getItem('djLanguage')
      setLanguage(storedLang === 'vietnamese' ? 'vietnamese' : 'english')
      const storedPersonality = localStorage.getItem('djPersonality')
      setPersonality(
        storedPersonality && DJ_PERSONALITY_IDS.includes(storedPersonality)
          ? storedPersonality
          : DEFAULT_DJ_PERSONALITY
      )
    }
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('djmode-changed', sync)
    window.addEventListener('djlanguage-changed', sync)
    window.addEventListener('djpersonality-changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('djmode-changed', sync)
      window.removeEventListener('djlanguage-changed', sync)
      window.removeEventListener('djpersonality-changed', sync)
    }
  }, [])

  if (!djEnabled || language !== 'english')
    return null as unknown as JSX.Element

  const handleSelect = (value: string): void => {
    setPersonality(value)
    localStorage.setItem('djPersonality', value)
    DJService.getInstance().invalidatePrefetch()
    window.dispatchEvent(new Event('djpersonality-changed'))
  }

  return (
    <div className='py-1'>
      <span className='text-white text-sm font-semibold'>DJ Personality</span>
      <div className='mt-1 flex flex-wrap gap-1'>
        {DJ_PERSONALITIES.map(({ value, label }) => (
          <button
            key={value}
            type='button'
            onClick={() => handleSelect(value)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              personality === value
                ? 'text-white bg-green-600'
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
