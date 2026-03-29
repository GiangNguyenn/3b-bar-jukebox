'use client'

export const SESSION_KEY = 'trivia_session'
export const PLAYER_NAME_KEY = 'trivia_player_name'

const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface StoredEntry {
  value: string
  expiresAt: number
}

function readEntry(key: string): string {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return ''
    const entry: StoredEntry = JSON.parse(raw)
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(key)
      return ''
    }
    return entry.value
  } catch {
    // Legacy plain-string values or corrupt data – treat as expired
    localStorage.removeItem(key)
    return ''
  }
}

function writeEntry(key: string, value: string): void {
  const entry: StoredEntry = { value, expiresAt: Date.now() + TTL_MS }
  localStorage.setItem(key, JSON.stringify(entry))
}

export function getOrCreateSession(): string {
  if (typeof window === 'undefined') return ''

  const existing = readEntry(SESSION_KEY)
  if (existing) return existing

  const sessionId = crypto.randomUUID()
  writeEntry(SESSION_KEY, sessionId)
  return sessionId
}

export function getSavedPlayerName(): string {
  if (typeof window === 'undefined') return ''
  return readEntry(PLAYER_NAME_KEY)
}

export function savePlayerName(name: string): void {
  if (typeof window === 'undefined') return
  writeEntry(PLAYER_NAME_KEY, name)
}

export const ANSWERS_KEY = 'trivia_answers_v1'

export function getSavedAnswers(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(ANSWERS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveAnswer(trackId: string, answerIndex: number): void {
  if (typeof window === 'undefined') return
  const answers = getSavedAnswers()
  answers[trackId] = answerIndex
  // Prevent unbounded growth by keeping only the last 50 tracked answers
  const keys = Object.keys(answers)
  if (keys.length > 50) {
    delete answers[keys[0]]
  }
  localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers))
}
