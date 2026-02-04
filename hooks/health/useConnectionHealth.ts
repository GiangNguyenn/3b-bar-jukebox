import { useState, useRef, useEffect } from 'react'
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
      const timeoutId = setTimeout(() => controller.abort(), 25000) // 25 second timeout for IPv6 fallback

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

  // Adaptive polling: check more frequently when disconnected to detect recovery faster
  const interval =
    connectionStatus === 'connected'
      ? 60000 // 60 seconds when healthy
      : 10000 // 10 seconds when disconnected

  useHealthInterval(updateConnectionStatus, {
    interval,
    enabled: true
  })

  // Listen for browser online/offline events for immediate updates
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOnline = () => {
      // Small delay to allow network to stabilize
      setTimeout(updateConnectionStatus, 1000)
    }

    const handleOffline = () => {
      setConnectionStatus('disconnected')
      lastConnectionStatus.current = 'disconnected'
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return connectionStatus
}
