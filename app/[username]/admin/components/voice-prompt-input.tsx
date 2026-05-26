'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface VoicePromptInputProps {
  onTranscript: (text: string) => void
  /** 'replace' overwrites the current value; 'append' adds to it */
  mode?: 'replace' | 'append'
  currentValue?: string
  disabled?: boolean
}

// Minimal Web Speech API types — not in all TS DOM libs
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}
interface SpeechRecognitionResultList {
  readonly length: number
  readonly [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEvent {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

function getSpeechRecognitionClass(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null
}

export function VoicePromptInput({
  onTranscript,
  mode = 'replace',
  currentValue = '',
  disabled = false
}: VoicePromptInputProps): JSX.Element | null {
  const [isSupported, setIsSupported] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const currentValueRef = useRef(currentValue)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  useEffect(() => {
    currentValueRef.current = currentValue
  }, [currentValue])

  useEffect(() => {
    setIsSupported(getSpeechRecognitionClass() !== null)
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setIsListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognitionClass()
    if (!SpeechRecognitionClass) return

    const recognition = new SpeechRecognitionClass()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      setInterim(interimText)
      if (finalText) {
        const trimmed = finalText.trim()
        const next =
          mode === 'append' && currentValueRef.current
            ? `${currentValueRef.current} ${trimmed}`
            : trimmed
        onTranscriptRef.current(next)
        setInterim('')
      }
    }

    recognition.onerror = () => {
      stop()
    }

    recognition.onend = () => {
      setIsListening(false)
      setInterim('')
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [mode, stop])

  const toggle = useCallback(() => {
    if (isListening) {
      stop()
    } else {
      start()
    }
  }, [isListening, start, stop])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  if (!isSupported) return null

  return (
    <div className='flex flex-col gap-1'>
      <button
        type='button'
        onClick={toggle}
        disabled={disabled}
        title={isListening ? 'Stop recording' : 'Speak your prompt'}
        className={[
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isListening
            ? 'text-white bg-red-600 hover:bg-red-700'
            : 'border border-border bg-background text-foreground hover:bg-muted',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        ].join(' ')}
      >
        {isListening ? (
          <>
            <span className='bg-white inline-block h-2 w-2 animate-pulse rounded-full' />
            Stop recording
          </>
        ) : (
          <>
            <MicIcon />
            Speak prompt
          </>
        )}
      </button>
      {interim && (
        <p className='text-xs italic text-muted-foreground'>
          &ldquo;{interim}&rdquo;
        </p>
      )}
    </div>
  )
}

function MicIcon(): JSX.Element {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' />
      <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
      <line x1='12' x2='12' y1='19' y2='22' />
    </svg>
  )
}
