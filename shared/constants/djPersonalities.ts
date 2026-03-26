export interface DJPersonalityOption {
  value: string
  label: string
  prompt: string
}

export const DEFAULT_DJ_PERSONALITY = 'chill'

export const DJ_PERSONALITIES: DJPersonalityOption[] = [
  { value: 'chill', label: 'Chill', prompt: 'laid back, relaxed and chill' },
  {
    value: 'hype',
    label: 'Hype',
    prompt: 'high-energy, enthusiastic and hype'
  },
  {
    value: 'smooth',
    label: 'Smooth',
    prompt: 'smooth, suave and sophisticated'
  },
  { value: 'witty', label: 'Witty', prompt: 'witty, clever and humorous' },
  {
    value: 'old-school',
    label: 'Old School',
    prompt: 'old-school, nostalgic and classic radio-style'
  },
  {
    value: 'storyteller',
    label: 'Storyteller',
    prompt: 'storytelling, narrative-driven and insightful'
  }
]

export const DJ_PERSONALITY_IDS = DJ_PERSONALITIES.map((p) => p.value)
