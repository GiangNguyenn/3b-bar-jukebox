'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNowPlayingRealtime } from '@/hooks/useNowPlayingRealtime'
import {
  getOrCreateSession,
  getSavedPlayerName,
  savePlayerName,
  getSavedAnswers,
  saveAnswer
} from './session'
import type { TriviaQuestionResponse } from '@/shared/validations/trivia'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

export interface UseTriviaGameOptions {
  profileId: string | null
  username: string
}

export interface UseTriviaGameResult {
  question: TriviaQuestionResponse | null
  selectedAnswer: number | null
  isCorrect: boolean | null
  score: number
  isLoading: boolean
  error: string | null
  selectAnswer: (index: number) => void
  playerName: string
  sessionId: string
  setPlayerName: (name: string) => void
  hasJoined: boolean
  joinGame: (name: string) => void
  timeUntilReset: number
  nowPlaying: SpotifyPlaybackState | null
}

function getSecondsUntilNextHour() {
  const now = new Date()
  const nextHour = new Date(now)
  nextHour.setHours(now.getHours() + 1, 0, 0, 0)
  return Math.max(0, Math.floor((nextHour.getTime() - now.getTime()) / 1000))
}

export function useTriviaGame({
  profileId,
  username
}: UseTriviaGameOptions): UseTriviaGameResult {
  const [sessionId, setSessionId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [hasJoined, setHasJoined] = useState(false)

  const [question, setQuestion] = useState<TriviaQuestionResponse | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [score, setScore] = useState(0)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeUntilReset, setTimeUntilReset] = useState(0)

  // We track the last fetched track id so we don't refetch infinitely
  const lastFetchedTrackIdRef = useRef<string | null>(null)

  const { data: nowPlaying } = useNowPlayingRealtime({
    profileId,
    fallbackInterval: 5000
  })

  // Initialize session
  useEffect(() => {
    const sid = getOrCreateSession()
    setSessionId(sid)
    const savedName = getSavedPlayerName()
    if (savedName) {
      setPlayerName(savedName)
      setHasJoined(true)
    }
  }, [])

  // Timer loop — display-only countdown. The actual reset is triggered by
  // the admin page via useTriviaResetTimer, which is always running.
  useEffect(() => {
    setTimeUntilReset(getSecondsUntilNextHour())

    const interval = setInterval(() => {
      setTimeUntilReset(getSecondsUntilNextHour())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Question fetching logic
  useEffect(() => {
    if (!profileId || !nowPlaying || !nowPlaying.item) return
    if (typeof window !== 'undefined' && localStorage.getItem('triviaEnabled') !== 'true') return

    const currentTrackId = nowPlaying.item.id
    if (currentTrackId === lastFetchedTrackIdRef.current) return

    // Song changed!
    lastFetchedTrackIdRef.current = currentTrackId
    setQuestion(null)
    setSelectedAnswer(null)
    setIsCorrect(null)
    setIsLoading(true)
    setError(null)

    fetch('/api/trivia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_id: profileId,
        spotify_track_id: currentTrackId,
        track_name: nowPlaying.item.name,
        artist_name: nowPlaying.item.artists[0]?.name || 'Unknown',
        album_name: nowPlaying.item.album.name || 'Unknown'
      })
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data: TriviaQuestionResponse) => {
        setQuestion(data)

        // Restore answered state from localStorage to prevent refresh cheating
        const savedAnswers = getSavedAnswers()
        const previousAnswer = savedAnswers[currentTrackId]
        if (previousAnswer !== undefined) {
          setSelectedAnswer(previousAnswer)
          setIsCorrect(previousAnswer === data.correctIndex)
        }
      })
      .catch((err) => {
        setError(err.message)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [nowPlaying, profileId])

  const joinGame = useCallback((name: string) => {
    if (!name.trim()) return
    setPlayerName(name)
    savePlayerName(name)
    setHasJoined(true)
  }, [])

  const selectAnswer = useCallback(
    (index: number) => {
      if (selectedAnswer !== null || !question || !profileId || !hasJoined)
        return

      setSelectedAnswer(index)
      const correct = index === question.correctIndex
      setIsCorrect(correct)

      if (nowPlaying?.item?.id) {
        saveAnswer(nowPlaying.item.id, index)
      }

      if (correct) {
        setScore((s) => s + 1)

        // Fire and forget score submission
        fetch('/api/trivia/scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile_id: profileId,
            session_id: sessionId,
            player_name: playerName
          })
        }).catch(console.error)
      }
    },
    [
      selectedAnswer,
      question,
      profileId,
      hasJoined,
      sessionId,
      playerName,
      nowPlaying
    ]
  )

  return {
    question,
    selectedAnswer,
    isCorrect,
    score,
    isLoading,
    error,
    selectAnswer,
    playerName,
    sessionId,
    setPlayerName,
    hasJoined,
    joinGame,
    timeUntilReset,
    nowPlaying
  }
}
