import { useCallback, useRef } from 'react'

export type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'

export function useDeviceHealth() {
  const currentStatusRef = useRef<DeviceHealthStatus>('unknown')

  const updateHealth = useCallback(
    (status: DeviceHealthStatus) => {
      if (status !== currentStatusRef.current) {
        currentStatusRef.current = status
      }
    },
    []
  )

  const reset = useCallback(() => {
    updateHealth('unknown')
  }, [updateHealth])

  return {
    updateHealth,
    reset,
    currentStatus: currentStatusRef.current
  }
} 