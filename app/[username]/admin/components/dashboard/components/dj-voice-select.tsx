'use client'

import { useState, useEffect } from 'react'
import { DJService } from '@/services/djService'
import {
  DJ_VOICES,
  DJ_VOICE_IDS,
  DEFAULT_DJ_VOICE
} from '@/shared/constants/djVoices'

export function DJVoiceSelect(): JSX.Element {
  const [djEnabled, setDjEnabled] = useState(false)
  const [language, setLanguage] = useState('english')
  const [voice, setVoice] = useState(DEFAULT_DJ_VOICE)

  useEffect(() => {
    const sync = (): void => {
      setDjEnabled(localStorage.getItem('djMode') === 'true')
      const storedLang = localStorage.getItem('djLanguage')
      setLanguage(storedLang === 'vietnamese' ? 'vietnamese' : 'english')
      const storedVoice = localStorage.getItem('djVoice')
      setVoice(
        storedVoice && DJ_VOICE_IDS.includes(storedVoice)
          ? storedVoice
          : DEFAULT_DJ_VOICE
      )
    }
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('djmode-changed', sync)
    window.addEventListener('djlanguage-changed', sync)
    window.addEventListener('djvoice-changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('djmode-changed', sync)
      window.removeEventListener('djlanguage-changed', sync)
      window.removeEventListener('djvoice-changed', sync)
    }
  }, [])

  if (!djEnabled || language !== 'english')
    return null as unknown as JSX.Element

  const handleSelect = (value: string): void => {
    setVoice(value)
    localStorage.setItem('djVoice', value)
    DJService.getInstance().invalidatePrefetch()
    window.dispatchEvent(new Event('djvoice-changed'))
  }

  return (
    <div className='py-1'>
      <span className='text-white text-sm font-semibold'>DJ Voice</span>
      <div className='mt-1 flex flex-wrap gap-1'>
        {DJ_VOICES.map(({ value, label }) => (
          <button
            key={value}
            type='button'
            onClick={() => handleSelect(value)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              voice === value
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
