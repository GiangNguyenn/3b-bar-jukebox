'use client'

import React from 'react'
import { useParams } from 'next/navigation'
import { useProfileId } from '@/hooks/useProfileId'
import { useTriviaGame } from '@/hooks/trivia/useTriviaGame'
import { useTriviaLeaderboard } from '@/hooks/trivia/useTriviaLeaderboard'

import { NameEntryModal } from './components/NameEntryModal'
import { NowPlayingHeader } from './components/NowPlayingHeader'
import { TriviaQuestion } from './components/TriviaQuestion'
import { PlayerScore } from './components/PlayerScore'
import { Leaderboard } from './components/Leaderboard'

export default function GamePage(): React.ReactElement {
  const params = useParams()
  const username = params?.username as string

  // Resolve venue profile id
  const {
    profileId,
    isLoading: isProfileLoading,
    error: profileError
  } = useProfileId(username || '')

  // Initialize Game engine and Leaderboard using the profile ID
  const gameState = useTriviaGame({
    profileId,
    username: username || ''
  })

  const leaderboardState = useTriviaLeaderboard({
    profileId
  })

  if (isProfileLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-black p-4'>
        <div className='h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent' />
      </div>
    )
  }

  if (profileError || !profileId) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-black p-4'>
        <div className='rounded-xl border border-red-800 bg-red-900/30 p-6'>
          <h2 className='mb-2 text-xl font-bold text-red-500'>
            Venue Not Found
          </h2>
          <p className='text-red-400'>
            Could not find a venue with the username @{username}
          </p>
        </div>
      </div>
    )
  }

  // Derive true score from leaderboard if available, otherwise fallback to optimistic local score
  const myEntry = leaderboardState.entries.find(
    (e) => e.session_id === gameState.sessionId
  )
  const displayScore = myEntry ? myEntry.score : gameState.score

  return (
    <div className='min-h-screen bg-black font-sans text-zinc-100 selection:bg-indigo-500/30'>
      <div className='mx-auto w-full max-w-3xl p-4 pt-6 sm:p-6 sm:pt-10 md:p-8'>
        <header className='mb-8 text-center'>
          <h1 className='bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-3xl font-black tracking-tight text-transparent'>
            Song Trivia
          </h1>
        </header>

        {!gameState.hasJoined && <NameEntryModal onJoin={gameState.joinGame} />}

        <main className='flex flex-col gap-2'>
          <NowPlayingHeader
            trackName={gameState.nowPlaying?.item?.name ?? null}
            artistName={gameState.nowPlaying?.item?.artists[0]?.name ?? null}
            albumArtUrl={
              gameState.nowPlaying?.item?.album.images?.[0]?.url ?? null
            }
          />

          <TriviaQuestion
            question={gameState.question}
            selectedAnswer={gameState.selectedAnswer}
            isCorrect={gameState.isCorrect}
            isLoading={gameState.isLoading}
            error={gameState.error}
            onSelectAnswer={gameState.selectAnswer}
          />

          <PlayerScore
            score={displayScore}
            timeUntilReset={gameState.timeUntilReset}
          />

          <Leaderboard
            entries={leaderboardState.entries}
            isLoading={leaderboardState.isLoading}
            currentSessionId={gameState.sessionId}
          />
        </main>
      </div>
    </div>
  )
}
