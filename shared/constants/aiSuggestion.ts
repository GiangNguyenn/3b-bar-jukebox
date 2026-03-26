export interface PresetPrompt {
  id: string
  label: string
  emoji: string
  prompt: string
}

export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: 'party',
    label: 'Party',
    emoji: '🎉',
    prompt: 'Upbeat, high-energy party songs that get people dancing. Mix of pop, dance, and hip hop hits.'
  },
  {
    id: 'chill',
    label: 'Chill',
    emoji: '☕',
    prompt: 'Relaxed, mellow songs for a laid-back atmosphere. Lo-fi, acoustic, jazz, and soft indie.'
  },
  {
    id: 'rock',
    label: 'Rock',
    emoji: '🎸',
    prompt: 'Rock classics and modern rock anthems. Alternative, indie rock, and classic rock.'
  },
  {
    id: 'throwback',
    label: 'Throwback',
    emoji: '📻',
    prompt: 'Nostalgic hits from the 70s, 80s, and 90s. Classic soul, disco, new wave, and retro pop.'
  },
  {
    id: 'indie',
    label: 'Indie',
    emoji: '🎧',
    prompt: 'Independent and alternative music. Indie pop, indie rock, dream pop, and shoegaze.'
  },
  {
    id: 'hiphop',
    label: 'Hip Hop',
    emoji: '🎤',
    prompt: 'Hip hop and R&B tracks. Mix of classic boom bap, modern trap, and smooth R&B.'
  },
  {
    id: 'electronic',
    label: 'Electronic',
    emoji: '🎛️',
    prompt: 'Electronic and dance music. House, techno, ambient, and synth-driven tracks.'
  },
  {
    id: 'acoustic',
    label: 'Acoustic',
    emoji: '🪕',
    prompt: 'Acoustic and unplugged music. Singer-songwriter, folk, country, and acoustic covers.'
  },
  {
    id: 'vpop',
    label: 'V-Pop',
    emoji: '🇻🇳',
    prompt: 'Popular Vietnamese music (V-Pop). Trending Vietnamese hits, ballads, and modern Vietnamese pop songs.'
  },
  {
    id: 'vrock',
    label: 'Viet Rock & Hip Hop',
    emoji: '🎸🇻🇳',
    prompt: 'Vietnamese rock and hip hop. Vietnamese rap, Viet rock bands, and Vietnamese hip hop artists.'
  },
  {
    id: 'punk-metal',
    label: 'Punk & Metal',
    emoji: '🤘',
    prompt: 'Punk and metal music. Hardcore punk, pop punk, thrash metal, metalcore, and heavy metal anthems.'
  }
]

export const MAX_CUSTOM_PROMPT_LENGTH = 500
export const SUGGESTION_BATCH_SIZE = 10
export const AI_SUGGESTIONS_STORAGE_KEY = 'ai-suggestions-state'

export function truncatePrompt(prompt: string): string {
  if (prompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
    return prompt.slice(0, MAX_CUSTOM_PROMPT_LENGTH)
  }
  return prompt
}

export function deriveActivePrompt(
  selectedPresetId: string | null,
  customPrompt: string
): string {
  const trimmed = customPrompt.trim()
  if (trimmed.length > 0) {
    return trimmed
  }
  if (selectedPresetId !== null) {
    const preset = PRESET_PROMPTS.find((p) => p.id === selectedPresetId)
    if (preset) {
      return preset.prompt
    }
  }
  return ''
}
