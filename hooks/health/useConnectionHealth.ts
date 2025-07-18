import { useState, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'

type ConnectionStatus = 'connected' | 'disconnected'

export function useConnectionHealth(): ConnectionStatus {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connected')
  const { addLog } = useConsoleLogsContext()
  const lastConnectionStatus = useRef<string>('connected')

  useEffect(() => {
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
      } catch (error) {
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

    // Initial check
    void updateConnectionStatus()

    // Set up periodic connection test (every 30 seconds)
    const connectionTestInterval = setInterval(() => {
      void updateConnectionStatus()
    }, 30000)

    return () => {
      clearInterval(connectionTestInterval)
    }
  }, [addLog])

  return connectionStatus
}
