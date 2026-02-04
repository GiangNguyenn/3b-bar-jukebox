/**
 * Connectivity Investigator Service
 *
 * Automatically investigates network failures to diagnose IPv6/IPv4 connectivity issues.
 * Running investigations capture protocol tests, DNS info, edge region, and suspected issues.
 */

import type {
  ConnectivityReport,
  ConnectivityInvestigation,
  FailedRequestInfo,
  RequestContext,
  ProtocolTestResult
} from '@/shared/types/connectivity'
import { categorizeNetworkError } from './networkErrorDetection'

const MAX_RECENT_FAILURES = 10
const INVESTIGATION_THROTTLE_MS = 30000 // 30 seconds
const PROTOCOL_TEST_TIMEOUT_MS = 25000

class ConnectivityInvestigatorService {
  private recentFailures: FailedRequestInfo[] = []
  private lastInvestigation: ConnectivityReport | null = null
  private lastInvestigationTime = 0
  private ipv4Status: ProtocolTestResult = { available: false, tested: false }
  private ipv6Status: ProtocolTestResult = { available: false, tested: false }
  private lastProtocolTest = 0

  /**
   * Record a failed network request
   */
  recordFailure(error: unknown, context: RequestContext): void {
    const errorInfo = categorizeNetworkError(error)

    const failure: FailedRequestInfo = {
      timestamp: context.timestamp,
      url: context.url,
      method: context.method,
      error: errorInfo.message,
      errorType:
        errorInfo.type === 'network'
          ? 'network'
          : errorInfo.type === 'unknown'
            ? 'unknown'
            : 'network'
    }

    // Add to recent failures (keep most recent)
    this.recentFailures = [failure, ...this.recentFailures].slice(
      0,
      MAX_RECENT_FAILURES
    )
  }

  /**
   * Trigger a full connectivity investigation
   * Returns immediately if throttled
   */
  async investigate(error: unknown, context: RequestContext): Promise<void> {
    // Throttle investigations
    const now = Date.now()
    if (now - this.lastInvestigationTime < INVESTIGATION_THROTTLE_MS) {
      this.recordFailure(error, context)
      return
    }

    this.lastInvestigationTime = now
    this.recordFailure(error, context)

    // Run investigation in background
    try {
      const report = await this.runInvestigation(error, context)
      this.lastInvestigation = report
    } catch (error) {
      console.error('[ConnectivityInvestigator] Investigation failed:', error)
    }
  }

  /**
   * Get current investigation state
   */
  getInvestigation(): ConnectivityInvestigation | null {
    if (this.recentFailures.length === 0 && !this.lastInvestigation) {
      return null
    }

    return {
      lastInvestigation: this.lastInvestigation ?? undefined,
      recentFailures: this.recentFailures,
      protocolStatus: {
        ipv4: this.ipv4Status,
        ipv6: this.ipv6Status,
        lastTested: this.lastProtocolTest
      },
      suspectedIssues: this.analyzeSuspectedIssues()
    }
  }

  /**
   * Clear all investigation history
   */
  clearHistory(): void {
    this.recentFailures = []
    this.lastInvestigation = null
  }

  /**
   * Run a full investigation
   */
  private async runInvestigation(
    error: unknown,
    context: RequestContext
  ): Promise<ConnectivityReport> {
    const errorInfo = categorizeNetworkError(error)
    const networkState = this.captureNetworkState()

    // Test both protocols
    const [ipv4Result, ipv6Result] = await Promise.all([
      this.testProtocol('ipv4'),
      this.testProtocol('ipv6')
    ])

    this.ipv4Status = ipv4Result
    this.ipv6Status = ipv6Result
    this.lastProtocolTest = Date.now()

    // Determine suspected issues and recommendations
    const suspectedIssues = this.determineSuspectedIssues(
      ipv4Result,
      ipv6Result,
      errorInfo.type
    )
    const recommendations = this.generateRecommendations(
      ipv4Result,
      ipv6Result,
      suspectedIssues
    )

    return {
      id: `investigation-${Date.now()}`,
      timestamp: Date.now(),
      trigger: {
        url: context.url,
        method: context.method,
        error: errorInfo.message,
        errorType: errorInfo.type as 'network' | 'timeout' | 'dns' | 'unknown'
      },
      networkState,
      protocolTests: {
        ipv4: ipv4Result,
        ipv6: ipv6Result
      },
      suspectedIssues,
      recommendations
    }
  }

  /**
   * Capture current network state
   */
  private captureNetworkState() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return {
        browserOnline: false,
        connectionType: 'unknown',
        effectiveType: 'unknown'
      }
    }

    const conn =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection

    return {
      browserOnline: navigator.onLine,
      connectionType: conn?.type || 'unknown',
      effectiveType: conn?.effectiveType || 'unknown',
      downlink: conn?.downlink,
      rtt: conn?.rtt
    }
  }

  /**
   * Test connectivity for a specific protocol
   */
  private async testProtocol(
    protocol: 'ipv4' | 'ipv6'
  ): Promise<ProtocolTestResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        PROTOCOL_TEST_TIMEOUT_MS
      )

      const startTime = performance.now()

      // Test connectivity check endpoint
      const response = await fetch(
        `/api/connectivity-check?protocol=${protocol}`,
        {
          method: 'HEAD',
          signal: controller.signal,
          cache: 'no-store'
        }
      )

      clearTimeout(timeoutId)
      const latency = performance.now() - startTime

      return {
        available: response.ok,
        tested: true,
        latency: Math.round(latency),
        error: response.ok ? undefined : `HTTP ${response.status}`
      }
    } catch (error) {
      return {
        available: false,
        tested: true,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Analyze suspected issues based on failure patterns
   */
  private analyzeSuspectedIssues(): string[] {
    const issues: string[] = []

    // Check for consistent IPv6 failures
    const recentIPv6Failures = this.recentFailures.filter(
      (f) =>
        f.error.toLowerCase().includes('ipv6') ||
        f.error.toLowerCase().includes('network')
    )

    if (recentIPv6Failures.length >= 3) {
      issues.push('Consistent IPv6 connectivity failures detected')
    }

    // Check protocol status
    if (!this.ipv6Status.available && this.ipv6Status.tested) {
      issues.push('IPv6 connectivity unavailable')
    }

    if (!this.ipv4Status.available && this.ipv4Status.tested) {
      issues.push('IPv4 connectivity unavailable')
    }

    // Check for timeout patterns
    const timeoutFailures = this.recentFailures.filter(
      (f) => f.errorType === 'timeout'
    )
    if (timeoutFailures.length >= 3) {
      issues.push('Multiple timeout failures detected')
    }

    return issues
  }

  /**
   * Determine suspected issues from test results
   */
  private determineSuspectedIssues(
    ipv4: ProtocolTestResult,
    ipv6: ProtocolTestResult,
    errorType: string
  ): string[] {
    const issues: string[] = []

    if (!ipv4.available && !ipv6.available) {
      issues.push(
        'Complete loss of connectivity - both IPv4 and IPv6 unavailable'
      )
    } else if (!ipv6.available && ipv4.available) {
      issues.push('IPv6 connectivity issue - only IPv4 is working')
    } else if (!ipv4.available && ipv6.available) {
      issues.push('IPv4 connectivity issue - only IPv6 is working')
    }

    if (errorType === 'timeout') {
      issues.push(
        'Request timeout - possible network congestion or slow connection'
      )
    }

    if (ipv6.latency && ipv6.latency > 1000) {
      issues.push('High IPv6 latency detected (>1s)')
    }

    if (ipv4.latency && ipv4.latency > 1000) {
      issues.push('High IPv4 latency detected (>1s)')
    }

    return issues
  }

  /**
   * Generate troubleshooting recommendations
   */
  private generateRecommendations(
    ipv4: ProtocolTestResult,
    ipv6: ProtocolTestResult,
    suspectedIssues: string[]
  ): string[] {
    const recommendations: string[] = []

    if (!ipv4.available && !ipv6.available) {
      recommendations.push('Check internet connection')
      recommendations.push('Verify network settings')
      recommendations.push('Try refreshing the page')
    } else if (!ipv6.available && ipv4.available) {
      recommendations.push(
        'IPv6 connectivity issue detected - application should fallback to IPv4'
      )
      recommendations.push('Check IPv6 configuration if issues persist')
    }

    if (suspectedIssues.some((issue) => issue.includes('timeout'))) {
      recommendations.push('Check for network congestion')
      recommendations.push('Try a different network connection')
    }

    if (this.recentFailures.length >= 5) {
      recommendations.push(
        'Multiple failures detected - consider reporting to support'
      )
    }

    return recommendations
  }
}

// Export singleton instance
export const connectivityInvestigator = new ConnectivityInvestigatorService()
