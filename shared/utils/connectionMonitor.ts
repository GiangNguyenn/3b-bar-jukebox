import { useEffect, useRef, useState } from 'react'

// Network Information API types
interface NetworkInformation extends EventTarget {
  readonly type?:
    | 'bluetooth'
    | 'cellular'
    | 'ethernet'
    | 'none'
    | 'wifi'
    | 'wimax'
    | 'other'
    | 'unknown'
  readonly effectiveType?: 'slow-2g' | '2g' | '3g' | '4g'
  readonly downlink?: number
  readonly rtt?: number
  readonly saveData?: boolean
  onchange?: (this: NetworkInformation, ev: Event) => void
}

export type ConnectionStatus = 'good' | 'unstable' | 'poor' | 'unknown'

interface ConnectionMetrics {
  status: ConnectionStatus
  isOnline: boolean
  type?: string
  effectiveType?: string
  downlink?: number
  rtt?: number
  saveData?: boolean
}

const PING_INTERVAL = 5000 // 5 seconds
const PING_TIMEOUT = 3000 // 3 seconds
const PING_URL = '/api/ping' // Endpoint that responds quickly

export function useConnectionMonitor() {
  const [metrics, setMetrics] = useState<ConnectionMetrics>({
    status: 'unknown',
    isOnline: navigator.onLine
  })
  const pingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastPingTimeRef = useRef<number>(0)
  const consecutiveFailuresRef = useRef(0)

  // Function to check connection using Network Information API
  const checkNetworkInfo = (): Partial<ConnectionMetrics> => {
    const connection = (navigator as { connection?: NetworkInformation }).connection
    if (!connection) return { isOnline: navigator.onLine }

    const { type, effectiveType, downlink, rtt, saveData } = connection
    let status: ConnectionStatus = 'unknown'

    if (type === 'ethernet' || type === 'wifi') {
      status = 'good'
    } else if (
      effectiveType === '4g' &&
      downlink &&
      downlink >= 2 &&
      rtt &&
      rtt < 100
    ) {
      status = 'good'
    } else if (effectiveType === '3g' && downlink && downlink >= 1) {
      status = 'unstable'
    } else {
      status = 'poor'
    }

    return {
      status,
      isOnline: navigator.onLine,
      type,
      effectiveType,
      downlink,
      rtt,
      saveData
    }
  }

  // Function to check connection using ping
  const checkPing = async (): Promise<boolean> => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT)

      const response = await fetch(PING_URL, {
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

  // Function to update connection status
  const updateConnectionStatus = async () => {
    const now = Date.now()
    const timeSinceLastPing = now - lastPingTimeRef.current

    // Get Network Information API data
    const networkInfo = checkNetworkInfo()

    // Only perform ping check if enough time has passed
    if (timeSinceLastPing >= PING_INTERVAL) {
      const pingSuccess = await checkPing()
      lastPingTimeRef.current = now

      if (pingSuccess) {
        consecutiveFailuresRef.current = 0
      } else {
        consecutiveFailuresRef.current++
      }

      // Update status based on both Network Info and ping results
      setMetrics((prev) => {
        const newStatus: ConnectionStatus =
          !navigator.onLine || consecutiveFailuresRef.current >= 3
            ? 'poor'
            : networkInfo.status === 'unknown'
              ? pingSuccess
                ? 'good'
                : 'unstable'
              : networkInfo.status

        return {
          ...prev,
          ...networkInfo,
          status: newStatus
        }
      })
    } else {
      // Just update with Network Info
      setMetrics((prev) => ({
        ...prev,
        ...networkInfo
      }))
    }
  }

  // Set up event listeners and initial check
  useEffect(() => {
    const handleOnline = () => {
      setMetrics((prev) => ({ ...prev, isOnline: true }))
      void updateConnectionStatus()
    }

    const handleOffline = () => {
      setMetrics((prev) => ({ ...prev, isOnline: false, status: 'poor' }))
    }

    const handleNetworkChange = () => {
      void updateConnectionStatus()
    }

    // Initial check
    void updateConnectionStatus()

    // Set up event listeners
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const connection = (navigator as { connection?: NetworkInformation }).connection
    if (connection) {
      connection.addEventListener('change', handleNetworkChange)
    }

    // Set up periodic checks
    const intervalId = setInterval(updateConnectionStatus, PING_INTERVAL)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (connection) {
        connection.removeEventListener('change', handleNetworkChange)
      }
      clearInterval(intervalId)
      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current)
      }
    }
  }, [])

  return metrics
} 