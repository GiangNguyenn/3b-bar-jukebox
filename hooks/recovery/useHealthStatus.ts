import { useCallback } from 'react'

export type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'

interface HealthStatusState {
  device: DeviceHealthStatus
  lastUpdate: number
}

export function useHealthStatus(
  onUpdate: (status: { device: DeviceHealthStatus }) => void
) {
  const updateHealth = useCallback(
    (status: DeviceHealthStatus) => {
      onUpdate({ device: status })
    },
    [onUpdate]
  )

  const reset = useCallback(() => {
    updateHealth('unknown')
  }, [updateHealth])

  return {
    updateHealth,
    reset
  }
}
