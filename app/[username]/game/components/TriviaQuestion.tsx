'use client'

import React from 'react'
import type { TriviaQuestionResponse } from '@/shared/validations/trivia'

export interface TriviaQuestionProps {
  question: TriviaQuestionResponse | null
  selectedAnswer: number | null
  isCorrect: boolean | null
  isLoading: boolean
  error: string | null
  onSelectAnswer: (index: number) => void
}

export function TriviaQuestion({
  question,
  selectedAnswer,
  isCorrect,
  isLoading,
  error,
  onSelectAnswer
}: TriviaQuestionProps): React.ReactElement | null {
  if (error) {
    return (
      <div className="p-6 bg-red-900/30 rounded-xl border border-red-800/50 mb-6 text-center">
        <p className="text-red-400 font-medium">Failed to load trivia: {error}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-8 bg-zinc-900/30 rounded-xl mb-6 flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-zinc-400 font-medium animate-pulse">Generating trivia question...</p>
      </div>
    )
  }

  if (!question) {
    return null
  }

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 md:p-6 mb-6">
      <h3 className="text-xl md:text-2xl font-bold text-white mb-6 leading-relaxed">
        {question.question}
      </h3>

      <div className="flex flex-col gap-3">
        {question.options.map((opt, idx) => {
          const isSelected = selectedAnswer === idx
          const isCorrectAnswer = idx === question.correctIndex
          const showColors = selectedAnswer !== null

          let buttonClass = `
            relative p-4 md:p-5 rounded-lg text-left font-medium text-lg transition-all duration-200 
            border-2 w-full
          `

          if (!showColors) {
            buttonClass += ` bg-zinc-800 border-zinc-700 hover:bg-zinc-700 hover:border-zinc-500 text-zinc-100 cursor-pointer`
          } else {
            if (isCorrectAnswer) {
              buttonClass += ` bg-green-900/40 border-green-500 text-green-100 z-10 shadow-[0_0_15px_rgba(34,197,94,0.3)]`
            } else if (isSelected && !isCorrectAnswer) {
              buttonClass += ` bg-red-900/40 border-red-500 text-red-100`
            } else {
              buttonClass += ` bg-zinc-900/50 border-zinc-800 text-zinc-500 opacity-60`
            }
            buttonClass += ` cursor-not-allowed`
          }

          return (
            <button
              key={idx}
              onClick={() => onSelectAnswer(idx)}
              disabled={selectedAnswer !== null}
              className={buttonClass.trim()}
            >
              {opt}
            </button>
          )
        })}
      </div>

      {selectedAnswer !== null && (
        <div className="mt-6 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
          {isCorrect ? (
            <div className="inline-block px-4 py-2 bg-green-900/50 text-green-400 font-bold rounded-full border border-green-800">
              ✓ Correct! +1 Point
            </div>
          ) : (
            <div className="inline-block px-4 py-2 bg-red-900/50 text-red-400 font-bold rounded-full border border-red-800">
              ✗ Incorrect!
            </div>
          )}
        </div>
      )}
    </div>
  )
}
