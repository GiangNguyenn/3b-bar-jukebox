import { useMemo } from 'react'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { useSpotifyPlayerStore } from './useSpotifyPlayer'
import { useFixedPlaylist } from './useFixedPlaylist'
import {
  useTokenHealth,
  useDeviceHealth,
  useConnectionHealth,
  usePlaybackHealth,
  useFixedPlaylistHealth
} from './health'
import { HealthStatus } from '@/shared/types/health'

export function useSpotifyHealthMonitor(): HealthStatus {
  const { addLog } = useConsoleLogsContext()
  const { deviceId } = useSpotifyPlayerStore()
  const {
    fixedPlaylistId,
    isLoading: isFixedPlaylistLoading,
    error: fixedPlaylistError
  } = useFixedPlaylist()

  // Use focused health hooks
  const tokenHealth = useTokenHealth()
  const deviceHealth = useDeviceHealth(deviceId)
  const connectionHealth = useConnectionHealth()
  const playbackHealth = usePlaybackHealth()
  const fixedPlaylistHealth = useFixedPlaylistHealth(
    fixedPlaylistId,
    isFixedPlaylistLoading,
    fixedPlaylistError
  )

  // Map the new health status to the old interface structure
  const healthStatus = useMemo((): HealthStatus => {
    return {
      deviceId,
      device: deviceHealth,
      playback: playbackHealth,
      token: tokenHealth.status,
      tokenExpiringSoon: tokenHealth.expiringSoon,
      connection: connectionHealth,
      fixedPlaylist: fixedPlaylistHealth
    }
  }, [
    deviceId,
    tokenHealth,
    deviceHealth,
    connectionHealth,
    playbackHealth,
    fixedPlaylistHealth
  ])

  return healthStatus
}
