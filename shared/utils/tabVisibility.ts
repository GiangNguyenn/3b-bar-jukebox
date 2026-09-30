/**
 * Whether the tab is in the background, and for how long. Browsers throttle
 * timers and may suspend audio in a hidden tab, so player and recovery logs
 * include this to show whether a failure happened in the background.
 *
 * No dependencies on the player or diagnostics modules, so anything can
 * import it.
 */

let hiddenSince: number | null = null
let listening = false

function ensureListening(): void {
  if (listening || typeof document === 'undefined') return
  listening = true
  // The moment it was hidden is unknown if we start out hidden
  hiddenSince = document.hidden ? Date.now() : null
  document.addEventListener('visibilitychange', () => {
    hiddenSince = document.hidden ? Date.now() : null
  })
}

/** Milliseconds the tab has been hidden, or null when it is visible. */
export function getTabHiddenMs(): number | null {
  ensureListening()
  return hiddenSince === null ? null : Date.now() - hiddenSince
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** 'visible', or e.g. 'hidden for 14m 5s'. */
export function describeTabVisibility(): string {
  if (typeof document === 'undefined') return 'unknown'
  const hiddenMs = getTabHiddenMs()
  return hiddenMs === null
    ? 'visible'
    : `hidden for ${formatDuration(hiddenMs)}`
}
