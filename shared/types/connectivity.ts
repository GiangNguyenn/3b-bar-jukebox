export interface ProtocolTestResult {
  available: boolean
  tested: boolean
  latency?: number
  error?: string
}

export interface DNSResolutionInfo {
  records?: string[]
  error?: string
}

export interface ConnectivityReport {
  id: string
  timestamp: number
  trigger: {
    url: string
    method: string
    error: string
    errorType: 'network' | 'timeout' | 'dns' | 'unknown'
  }
  networkState: {
    browserOnline: boolean
    connectionType: string
    effectiveType: string
    downlink?: number
    rtt?: number
  }
  protocolTests: {
    ipv4: ProtocolTestResult
    ipv6: ProtocolTestResult
  }
  dnsInfo?: DNSResolutionInfo
  edgeInfo?: {
    region: string
    protocol: 'ipv4' | 'ipv6'
  }
  suspectedIssues: string[]
  recommendations: string[]
}

export interface FailedRequestInfo {
  timestamp: number
  url: string
  method: string
  error: string
  errorType: 'network' | 'timeout' | 'dns' | 'unknown'
  headers?: Record<string, string>
}

export interface RequestContext {
  url: string
  method: string
  timestamp: number
  headers?: Record<string, string>
}

export interface ConnectivityInvestigation {
  lastInvestigation?: ConnectivityReport
  recentFailures: FailedRequestInfo[]
  protocolStatus: {
    ipv4: ProtocolTestResult
    ipv6: ProtocolTestResult
    lastTested: number
  }
  suspectedIssues: string[]
}
