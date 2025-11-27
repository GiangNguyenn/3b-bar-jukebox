import { useState, useRef } from 'react'
import { useHealthInterval } from './utils/useHealthInterval'

type ConnectionStatus = 'connected' | 'disconnected'

const CONNECTION_CHECK_INTERVAL = 60000 // 60 seconds - reduced frequency

export function useConnectionHealth(): ConnectionStatus {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connected')
  const lastConnectionStatus = useRef<string>('connected')

  const testConnection = async (): Promise<boolean> => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000) // 3 second timeout

      const response = await fetch('/api/ping', {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store'
      })

      clearTimeout(timeoutId)
      return response.ok
    } catch {
      return false
    }
  }

  const updateConnectionStatus = async (): Promise<void> => {
    const isConnected = await testConnection()
    const newStatus: ConnectionStatus = isConnected
      ? 'connected'
      : 'disconnected'

    if (newStatus !== lastConnectionStatus.current) {
      setConnectionStatus(newStatus)
      lastConnectionStatus.current = newStatus
    }
  }

  useHealthInterval(updateConnectionStatus, {
    interval: CONNECTION_CHECK_INTERVAL,
    enabled: true
  })

  return connectionStatus
}
