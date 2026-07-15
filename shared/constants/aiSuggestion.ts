export interface PresetPrompt {
  id: string
  label: string
  emoji: string
  prompt: string
}

export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: 'drinking-anthems',
    label: 'Drinking Anthems',
    emoji: '🍺',
    prompt:
      'Classic drinking songs, pub anthems, and bar singalongs. Songs about beer, whiskey, pubs, bars, and drinking culture from rock, folk, and pop.'
  },
  {
    id: 'party',
    label: 'Party',
    emoji: '🎉',
    prompt:
      'Upbeat, high-energy party songs that get people dancing. Mix of pop, dance, and hip hop hits.'
  },
  {
    id: 'chill',
    label: 'Chill',
    emoji: '☕',
    prompt:
      'Relaxed, mellow songs for a laid-back atmosphere. Lo-fi, acoustic, jazz, and soft indie.'
  },
  {
    id: 'rock',
    label: 'Rock',
    emoji: '🎸',
    prompt:
      'Rock classics and modern rock anthems. Alternative, indie rock, and classic rock.'
  },
  {
    id: 'throwback',
    label: 'Throwback',
    emoji: '📻',
    prompt:
      'Nostalgic hits from the 70s, 80s, and 90s. Classic soul, disco, new wave, and retro pop.'
  },
  {
    id: 'indie',
    label: 'Indie',
    emoji: '🎧',
    prompt:
      'Independent and alternative music. Indie pop, indie rock, dream pop, and shoegaze.'
  },
  {
    id: 'hiphop',
    label: 'Hip Hop',
    emoji: '🎤',
    prompt:
      'Hip hop and R&B tracks. Mix of classic boom bap, modern trap, and smooth R&B.'
  },
  {
    id: 'electronic',
    label: 'Electronic',
    emoji: '🎛️',
    prompt:
      'Electronic and dance music. House, techno, and synth-driven tracks.'
  },
  {
    id: 'acoustic',
    label: 'Acoustic',
    emoji: '🪕',
    prompt:
      'Acoustic and unplugged music. Singer-songwriter, folk, and acoustic covers.'
  },
  {
    id: 'vpop',
    label: 'V-Pop',
    emoji: '🇻🇳',
    prompt:
      'Popular, upbeat Vietnamese pop (V-Pop) for a bar crowd. Trending Vietnamese hits, catchy ballads, and modern V-Pop stars like Sơn Tùng M-TP, Mỹ Tâm, and Đen Vâu.'
  },
  {
    id: 'vrock',
    label: 'Viet Rock & Hip Hop',
    emoji: '🎸🇻🇳',
    prompt:
      'Vietnamese rock and hip hop with bar-ready energy. Vietnamese rap and hip hop from artists like Suboi, alongside Viet rock bands and rock-influenced Vietnamese pop.'
  },
  {
    id: 'punk-metal',
    label: 'Punk & Metal',
    emoji: '🤘',
    prompt:
      'Punk and metal music. Hardcore punk, pop punk, thrash metal, metalcore, and heavy metal anthems.'
  },
  {
    id: 'dream-femme',
    label: 'Dream Femme',
    emoji: '🌙',
    prompt:
      'Dreamy, melancholic female-fronted indie and pop for a moody late-night bar. Cinematic and atmospheric songs with lush production, haunting vocals, and nostalgic moods. Dream pop, baroque pop, and ethereal indie.'
  },
  {
    id: 'riot-grrrl',
    label: 'Riot Grrrl',
    emoji: '✊',
    prompt:
      'Riot grrrl and feminist punk for a bar with attitude. Raw, energetic female-fronted punk and alternative rock with fierce, empowering energy and singalong hooks. Distorted guitars, powerful vocals, and unapologetic attitude.'
  },
  {
    id: 'soul-funk',
    label: 'Soul & Funk',
    emoji: '🕺',
    prompt:
      'Soulful and funky grooves. Motown classics, classic soul, funk, and neo-soul. Warm basslines, horns, and smooth vocals made for moving.'
  },
  {
    id: 'aussie',
    label: 'Aussie',
    emoji: '🦘',
    prompt:
      'Australian music across genres. Classic Aussie pub rock, hard rock, indie, and hip hop. Spanning legendary bands and iconic new wave to modern indie and contemporary Australian artists.'
  }
]

export const MAX_CUSTOM_PROMPT_LENGTH = 500
export const SUGGESTION_BATCH_SIZE = 10
export const AI_SUGGESTIONS_STORAGE_KEY = 'ai-suggestions-state'

// Client-side (per-browser) record of tracks the AI has recently suggested,
// used to widen the exclusion list beyond "currently queued" so repeated
// auto-fill calls don't keep re-suggesting the same tracks within a session.
export const AI_SUGGESTED_HISTORY_STORAGE_KEY_PREFIX = 'ai-suggested-history:'
export const AI_SUGGESTED_HISTORY_WINDOW_MS = 60 * 60 * 1000

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
