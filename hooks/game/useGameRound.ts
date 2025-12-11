import { useState, useRef, useEffect } from 'react'
import { ExplorationPhase } from '@/services/game/dgsTypes'
import { getExplorationPhase, MAX_ROUND_TURNS } from '@/services/game/gameRules'

interface UseGameRoundResult {
  roundTurn: number
  turnCounter: number
  explorationPhase: ExplorationPhase
  ogDrift: number
  hardConvergenceActive: boolean

  // Refs for use in async effects to avoid stale closures
  roundTurnRef: React.MutableRefObject<number>
  turnCounterRef: React.MutableRefObject<number>

  incrementTurn: (shouldContinueRound?: boolean) => void
  reset: () => void
}

export function useGameRound(): UseGameRoundResult {
  const [roundTurn, setRoundTurn] = useState(1)
  const [turnCounter, setTurnCounter] = useState(1)

  const [explorationPhase, setExplorationPhase] = useState<ExplorationPhase>({
    level: 'high',
    ogDrift: 0,
    rounds: [1, 3]
  })
  const [ogDrift, setOgDrift] = useState(0)
  const [hardConvergenceActive, setHardConvergenceActive] = useState(false)

  const roundTurnRef = useRef(1)
  const turnCounterRef = useRef(1)

  // Sync refs and derived state when roundTurn changes
  useEffect(() => {
    const phase = getExplorationPhase(roundTurn)
    setExplorationPhase(phase)
    setOgDrift(phase.ogDrift)
    setHardConvergenceActive(roundTurn >= MAX_ROUND_TURNS)

    // Check if refs are out of sync (they shouldn't be if we update them together, but safe guard)
    if (roundTurnRef.current !== roundTurn) {
      roundTurnRef.current = roundTurn
    }
  }, [roundTurn])

  // Sync turnCounter ref
  useEffect(() => {
    if (turnCounterRef.current !== turnCounter) {
      turnCounterRef.current = turnCounter
    }
  }, [turnCounter])

  const incrementTurn = (shouldContinueRound = false) => {
    if (shouldContinueRound) {
      // Continuous play (e.g. player successfully picked)
      setRoundTurn((prev) => {
        const next = prev + 1
        roundTurnRef.current = next
        return next
      })
    } else {
      // Just increment total turns, maybe user missed or something else happened
      // But typically in this game, "incrementTurn" implies proceeding.
      // If we want to reset roundTurn, that's done via separate "resetGame" or manual target set.
      // Wait, looking at original code:
      /*
              if (wasPlayerSelected) {
                 setRoundTurn(next)
                 setTurnCounter(next)
              }
            */
      // It seems roundTurn AND turnCounter increment together on success.
    }

    // Always increment global turn counter
    setTurnCounter((prev) => {
      const next = prev + 1
      turnCounterRef.current = next
      return next
    })
  }

  const reset = () => {
    setRoundTurn(1)
    setTurnCounter(1)
    roundTurnRef.current = 1
    turnCounterRef.current = 1
  }

  // Specialized update for "continue but keep accumulating round turns" vs "reset round turns"
  // The original code has logic where `roundTurn` increments on successful selection.
  // And `turnCounter` increments too.
  // When targets are manually changed, round resets to 1.

  return {
    roundTurn,
    turnCounter,
    explorationPhase,
    ogDrift,
    hardConvergenceActive,
    roundTurnRef,
    turnCounterRef,
    incrementTurn,
    reset
  }
}
