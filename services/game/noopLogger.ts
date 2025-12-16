/**
 * No-op logger for silencing logs in game services.
 */
export function createNoopLogger(): (
  level: unknown,
  message: unknown,
  context?: unknown,
  error?: unknown
) => void {
  return () => {
    /* no-op */
  }
}

