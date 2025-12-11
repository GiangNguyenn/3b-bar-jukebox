import { useState, useEffect } from 'react'

const PLAYER_NAMES_STORAGE_KEY = 'music-game-player-names'

interface PlayerNames {
  player1: string
  player2: string
}

const DEFAULT_NAMES: PlayerNames = {
  player1: 'Player 1',
  player2: 'Player 2'
}

export function usePlayerNames() {
  const [playerNames, setPlayerNames] = useState<PlayerNames>(() => {
    // Load from localStorage if available
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(PLAYER_NAMES_STORAGE_KEY)
      if (saved) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return JSON.parse(saved) as PlayerNames
        } catch {
          // Ignore parsing errors
        }
      }
    }
    return DEFAULT_NAMES
  })

  // Persist to localStorage whenever names change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        PLAYER_NAMES_STORAGE_KEY,
        JSON.stringify(playerNames)
      )
    }
  }, [playerNames])

  const updatePlayerName = (playerId: 'player1' | 'player2', name: string) => {
    setPlayerNames((prev) => ({ ...prev, [playerId]: name }))
  }

  return { playerNames, updatePlayerName }
}
