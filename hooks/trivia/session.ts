'use client'

export const SESSION_KEY = 'trivia_session'
export const PLAYER_NAME_KEY = 'trivia_player_name'

export function getOrCreateSession(): string {
  if (typeof window === 'undefined') return ''
  
  let sessionId = localStorage.getItem(SESSION_KEY)
  if (!sessionId) {
    sessionId = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, sessionId)
  }
  return sessionId
}

export function getSavedPlayerName(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(PLAYER_NAME_KEY) || ''
}

export function savePlayerName(name: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(PLAYER_NAME_KEY, name)
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
