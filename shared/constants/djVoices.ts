export interface DJVoiceOption {
  value: string
  label: string
}

export const DEFAULT_DJ_VOICE = 'af_nova'

export const DJ_VOICES: DJVoiceOption[] = [
  { value: 'af_nova', label: 'Nova' },
  { value: 'af_heart', label: 'Heart' },
  { value: 'af_bella', label: 'Bella' },
  { value: 'af_nicole', label: 'Nicole' },
  { value: 'af_sarah', label: 'Sarah' },
  { value: 'af_sky', label: 'Sky' },
  { value: 'am_adam', label: 'Adam' },
  { value: 'am_michael', label: 'Michael' }
]

export const DJ_VOICE_IDS = DJ_VOICES.map((v) => v.value)
