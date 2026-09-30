/**
 * Pure helpers for the diagnostics instrumentation (./instrumentation.ts).
 */

export interface RequestInfoSummary {
  method: string
  host: string
  // Pathname only: query strings can carry tokens
  path: string
  sameOrigin: boolean
}

export function describeRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origin: string
): RequestInfoSummary {
  let rawUrl: string
  let method = init?.method
  if (typeof input === 'string') {
    rawUrl = input
  } else if (input instanceof URL) {
    rawUrl = input.href
  } else {
    rawUrl = input.url
    method ??= input.method
  }

  try {
    const url = new URL(rawUrl, origin)
    return {
      method: (method ?? 'GET').toUpperCase(),
      host: url.host,
      path: url.pathname,
      sameOrigin: url.origin === origin
    }
  } catch {
    return {
      method: (method ?? 'GET').toUpperCase(),
      host: 'unknown',
      path: '',
      sameOrigin: false
    }
  }
}

/**
 * How loudly to record a request that failed. `status` is null when the
 * request threw instead of returning a response.
 */
export function failureLevel(
  status: number | null,
  errorName?: string
): 'INFO' | 'WARN' {
  if (status === null) {
    // Aborts are usually the app cancelling its own request
    return errorName === 'AbortError' ? 'INFO' : 'WARN'
  }
  if (status >= 500 || status === 401 || status === 408 || status === 429) {
    return 'WARN'
  }
  return 'INFO'
}

/** True for failures that suggest the host is unreachable or down. */
export function isOutageFailure(
  status: number | null,
  errorName?: string
): boolean {
  if (status === null) return errorName !== 'AbortError'
  return status >= 500
}

function formatConsoleArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  if (typeof arg === 'string') return arg
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg)
    } catch {
      return Object.prototype.toString.call(arg)
    }
  }
  return String(arg as number | boolean | bigint | symbol | undefined | null)
}

const CONTEXT_PREFIX = /^\[([^\]]{1,60})\]\s*/

/**
 * Turns console.warn/error arguments into a log line, picking up the
 * codebase's "[Context] message" convention.
 */
export function formatConsoleArgs(args: unknown[]): {
  context?: string
  message: string
  error?: Error
} {
  const error = args.find((arg): arg is Error => arg instanceof Error)
  let message = args.map(formatConsoleArg).join(' ')
  let context: string | undefined
  const match =
    typeof args[0] === 'string' ? CONTEXT_PREFIX.exec(message) : null
  if (match) {
    context = match[1]
    message = message.slice(match[0].length)
  }
  return { context, message, error }
}

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(fraction * sorted.length) - 1
  )
  return sorted[Math.max(0, index)]
}
