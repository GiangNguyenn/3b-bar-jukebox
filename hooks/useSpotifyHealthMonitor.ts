import { useMemo } from 'react'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { useSpotifyPlayerStore } from './useSpotifyPlayer'
import {
  useTokenHealth,
  useDeviceHealth,
  useConnectionHealth,
  usePlaybackHealth
} from './health'
import { HealthStatus } from '@/shared/types/health'

export function useSpotifyHealthMonitor(): HealthStatus {
  const { addLog } = useConsoleLogsContext()
  const { deviceId } = useSpotifyPlayerStore()
  // Use focused health hooks
  const tokenHealth = useTokenHealth()
  const deviceHealth = useDeviceHealth(deviceId)
  const connectionHealth = useConnectionHealth()
  const playbackHealth = usePlaybackHealth()

  // Map the new health status to the old interface structure
  const healthStatus = useMemo((): HealthStatus => {
    return {
      deviceId,
      device: deviceHealth,
      playback: playbackHealth,
      token: tokenHealth.status,
      tokenExpiringSoon: tokenHealth.expiringSoon,
      connection: connectionHealth
    }
  }, [deviceId, tokenHealth, deviceHealth, connectionHealth, playbackHealth])

  return healthStatus
}
