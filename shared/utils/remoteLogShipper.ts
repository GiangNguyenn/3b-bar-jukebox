/**
 * Ships browser logs, diagnostic snapshots and a heartbeat to
 * POST /api/diagnostics so a problem at the venue can be diagnosed remotely
 * (see docs/remote-diagnostics.md).
 *
 * WARN/ERROR lines are uploaded as they happen. INFO lines only sit in a
 * small in-memory "flight recorder" and are uploaded when something unusual
 * is detected, so a healthy jukebox stores next to nothing. The exception is
 * a handful of low-volume contexts (ALWAYS_UPLOAD_CONTEXTS) that make up the
 * playback timeline: those are uploaded at any level.
 *
 * A line that keeps repeating is uploaded once, then as one row a minute
 * carrying a repeat count, however many other lines are interleaved with it.
 *
 * This module must never log through the app's logger: a failed upload that
 * logged would enqueue another upload.
 */

export type RemoteLogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface RemoteLogInput {
  level: RemoteLogLevel
  message: string
  context?: string
  error?: unknown
  details?: Record<string, unknown>
  // Upload an INFO line as it happens instead of holding it in the recorder
  upload?: boolean
}

export interface RemoteLogEntry {
  ts: string
  level: RemoteLogLevel
  message: string
  context?: string
  repeatCount: number
  error?: { name?: string; message: string; stack?: string }
  details?: Record<string, unknown>
  path?: string
  // Set on entries restored from a previous page load
  sid?: string
  // Order of logging within this page load; timestamps alone can tie
  seq?: number
}

export interface RemoteSnapshot {
  trigger: string
  detail?: string
  severity: 'info' | 'warning' | 'error'
  page?: string
  capturedAt: string
  data: unknown
}

export interface RemoteHeartbeat {
  userAgent?: string
  state: Record<string, unknown>
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface RemoteLogShipperOptions {
  endpoint?: string
  fetchFn?: typeof fetch
  storage?: StorageLike | null
  // When false nothing is scheduled; callers drive flush() themselves (tests)
  autoFlush?: boolean
  sessionId?: string
  appVersion?: string
  now?: () => number
}

/**
 * Contexts whose INFO lines are uploaded as they happen. Each is a few lines
 * per track or per player start, and together they answer "what was the
 * jukebox doing, and when did it stop?" without needing a snapshot.
 */
export const ALWAYS_UPLOAD_CONTEXTS: ReadonlySet<string> = new Set([
  'PlaybackTimeline',
  'SpotifySDK',
  'PlayerInit'
])

const STORAGE_KEY = 'jukebox:diagnostics-queue'
const MAX_QUEUE = 500
const MAX_RECORDER = 200
const MAX_PENDING_SNAPSHOTS = 5
const BATCH_SIZE = 50
const MAX_MESSAGE_LENGTH = 2000
const MAX_ERROR_MESSAGE_LENGTH = 1000
const MAX_STACK_LENGTH = 2000
const MAX_DETAILS_LENGTH = 2000
const MAX_SNAPSHOT_BYTES = 100_000
const MAX_BEACON_BYTES = 55_000
const FLUSH_INTERVAL_MS = 10_000
const ERROR_FLUSH_DELAY_MS = 2_000
const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 60_000
// A repeating line gets one row per window, with a repeat count
const REPEAT_WINDOW_MS = 60_000

interface RepeatState {
  entry: RemoteLogEntry
  windowStart: number
  // Waiting for the window to close before being queued for upload
  held: boolean
  uploads: boolean
}

// Set while the app's own logger writes to the console, so the console tap
// (services/diagnostics/instrumentation.ts) doesn't capture the line twice.
let consoleTapSuppressed = false

export function withConsoleTapSuppressed(fn: () => void): void {
  const previous = consoleTapSuppressed
  consoleTapSuppressed = true
  try {
    fn()
  } finally {
    consoleTapSuppressed = previous
  }
}

export function isConsoleTapSuppressed(): boolean {
  return consoleTapSuppressed
}

const REDACTIONS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]'],
  [
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    '[redacted-jwt]'
  ],
  [
    /\b(access_token|refresh_token|id_token|token|apikey|api_key|code|client_secret)=[^&\s"']+/gi,
    '$1=[redacted]'
  ],
  // Spotify access/refresh tokens are long opaque strings
  [/\b[A-Za-z0-9_-]{80,}\b/g, '[redacted]']
]

export function redact(text: string): string {
  let result = text
  for (const [pattern, replacement] of REDACTIONS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function serializeError(error: unknown): RemoteLogEntry['error'] | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncate(redact(error.message), MAX_ERROR_MESSAGE_LENGTH),
      stack: error.stack
        ? truncate(redact(error.stack), MAX_STACK_LENGTH)
        : undefined
    }
  }
  return {
    message: truncate(
      redact(typeof error === 'string' ? error : safeStringify(error)),
      MAX_ERROR_MESSAGE_LENGTH
    )
  }
}

function sanitizeDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!details) return undefined
  const json = redact(safeStringify(details))
  if (json.length > MAX_DETAILS_LENGTH) {
    return { truncated: json.slice(0, MAX_DETAILS_LENGTH) }
  }
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return { truncated: json }
  }
}

// Heaviest parts of a snapshot first; the log lines they hold are in
// client_logs anyway.
const SNAPSHOT_TRIM_PATHS: string[][] = [
  ['logs'],
  ['details', 'internalState'],
  ['internalState'],
  ['details', 'recentEvents'],
  ['deduplicatedEvents'],
  ['details']
]

export function trimSnapshotData(data: unknown, maxBytes: number): unknown {
  let json = redact(safeStringify(data))
  if (json.length <= maxBytes) return parseOr(json, data)
  if (typeof data !== 'object' || data === null) {
    return { truncated: true }
  }

  const copy = parseOr(json, {}) as Record<string, unknown>
  for (const path of SNAPSHOT_TRIM_PATHS) {
    let target: Record<string, unknown> | undefined = copy
    for (const key of path.slice(0, -1)) {
      const next: unknown = target?.[key]
      target =
        typeof next === 'object' && next !== null
          ? (next as Record<string, unknown>)
          : undefined
    }
    const last = path[path.length - 1]
    if (target && last in target) {
      delete target[last]
      copy.truncated = true
      json = safeStringify(copy)
      if (json.length <= maxBytes) return copy
    }
  }
  return { truncated: true, summary: copy.summary }
}

function parseOr(json: string, fallback: unknown): unknown {
  try {
    return JSON.parse(json) as unknown
  } catch {
    return fallback
  }
}

function createSessionId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  // crypto.randomUUID is only available in secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    return (char === 'x' ? random : (random % 4) + 8).toString(16)
  })
}

function currentPath(): string | undefined {
  return typeof window !== 'undefined' ? window.location.pathname : undefined
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export class RemoteLogShipper {
  readonly sessionId: string
  private readonly endpoint: string
  private readonly fetchFn: typeof fetch
  private readonly storage: StorageLike | null
  private readonly autoFlush: boolean
  private readonly appVersion: string
  private readonly now: () => number

  private repeats = new Map<string, RepeatState>()
  private queue: RemoteLogEntry[] = []
  private recorder: RemoteLogEntry[] = []
  private snapshots: RemoteSnapshot[] = []
  private heartbeat: RemoteHeartbeat | null = null
  private listeners = new Set<(entry: RemoteLogEntry) => void>()

  private enabled = false
  private authBlocked = false
  private flushing = false
  private failures = 0
  private hasPersisted = false
  private nextSeq = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushDueAt = 0

  constructor(options: RemoteLogShipperOptions = {}) {
    this.endpoint = options.endpoint ?? '/api/diagnostics'
    this.fetchFn =
      options.fetchFn ?? ((input, init) => globalThis.fetch(input, init))
    this.storage =
      options.storage === undefined ? defaultStorage() : options.storage
    this.autoFlush = options.autoFlush ?? typeof window !== 'undefined'
    this.sessionId = options.sessionId ?? createSessionId()
    this.appVersion =
      options.appVersion ??
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      'dev'
    this.now = options.now ?? ((): number => Date.now())
    this.restore()
  }

  /**
   * Uploads only happen while enabled (a venue owner is signed in). Entries
   * logged before that are buffered, so startup logs aren't lost.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) {
      this.authBlocked = false
      if (this.hasWork()) this.scheduleFlush(0)
    }
  }

  enqueue(input: RemoteLogInput): void {
    // createModuleLogger repeats the context as a "[Module] " message prefix
    const prefix = input.context ? `[${input.context}] ` : ''
    const message =
      prefix && input.message.startsWith(prefix)
        ? input.message.slice(prefix.length)
        : input.message
    const entry: RemoteLogEntry = {
      ts: new Date().toISOString(),
      level: input.level,
      message: truncate(redact(message), MAX_MESSAGE_LENGTH),
      repeatCount: 1,
      seq: this.nextSeq++
    }
    if (input.context) entry.context = input.context
    const error = serializeError(input.error)
    if (error) entry.error = error
    const details = sanitizeDetails(input.details)
    if (details) entry.details = details
    const path = currentPath()
    if (path) entry.path = path

    const uploads =
      input.level !== 'INFO' ||
      input.upload === true ||
      (input.context !== undefined && ALWAYS_UPLOAD_CONTEXTS.has(input.context))
    const target = uploads ? this.queue : this.recorder

    const now = this.now()
    this.releaseHeld(now)

    const key = `${entry.level}|${entry.context ?? ''}|${entry.message}`
    const repeat = this.repeats.get(key)
    if (
      repeat &&
      repeat.uploads === uploads &&
      now - repeat.windowStart < REPEAT_WINDOW_MS &&
      (repeat.held || target.includes(repeat.entry))
    ) {
      // Same line again before its row has left: count it on that row
      repeat.entry.repeatCount++
    } else if (
      repeat &&
      uploads &&
      repeat.uploads &&
      now - repeat.windowStart < REPEAT_WINDOW_MS
    ) {
      // Its row is already uploaded (or on its way). Hold the repeats back
      // until the window closes, then upload them as a single row.
      repeat.entry = entry
      repeat.held = true
    } else {
      target.push(entry)
      const max = uploads ? MAX_QUEUE : MAX_RECORDER
      if (target.length > max) target.splice(0, target.length - max)
      this.repeats.set(key, { entry, windowStart: now, held: false, uploads })
    }

    if (uploads) {
      this.scheduleFlush(
        input.level === 'ERROR' ? ERROR_FLUSH_DELAY_MS : FLUSH_INTERVAL_MS
      )
    }

    this.listeners.forEach((listener) => {
      try {
        listener(entry)
      } catch {
        // A faulty listener must not break logging
      }
    })
  }

  /** Called for every log line, including INFO and repeats. */
  onEntry(listener: (entry: RemoteLogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Moves the buffered INFO lines into the upload queue. */
  flushRecorder(): void {
    if (this.recorder.length === 0) return
    this.queue.push(...this.recorder)
    this.recorder = []
    this.queue.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    if (this.queue.length > MAX_QUEUE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE)
    }
    this.scheduleFlush(ERROR_FLUSH_DELAY_MS)
  }

  queueSnapshot(snapshot: Omit<RemoteSnapshot, 'capturedAt' | 'page'>): void {
    this.snapshots.push({
      trigger: snapshot.trigger,
      detail: snapshot.detail
        ? truncate(redact(snapshot.detail), 500)
        : undefined,
      severity: snapshot.severity,
      page: currentPath(),
      capturedAt: new Date().toISOString(),
      data: trimSnapshotData(snapshot.data, MAX_SNAPSHOT_BYTES)
    })
    if (this.snapshots.length > MAX_PENDING_SNAPSHOTS) {
      this.snapshots.splice(0, this.snapshots.length - MAX_PENDING_SNAPSHOTS)
    }
    this.scheduleFlush(ERROR_FLUSH_DELAY_MS)
  }

  setHeartbeat(heartbeat: RemoteHeartbeat): void {
    this.heartbeat = heartbeat
    this.scheduleFlush(0)
  }

  getQueueSizes(): { queued: number; recorded: number; snapshots: number } {
    return {
      queued: this.queue.length,
      recorded: this.recorder.length,
      snapshots: this.snapshots.length
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled || this.authBlocked || this.flushing) return
    this.releaseHeld(this.now())
    if (!this.hasWork()) {
      this.scheduleHeldRelease()
      return
    }

    // Take the work out of the buffers for the duration of the request, so
    // entries logged meanwhile are neither lost nor sent twice.
    const logs = this.queue.splice(0, BATCH_SIZE)
    const snapshot = logs.length === 0 ? this.snapshots.shift() : undefined
    const heartbeat = this.heartbeat
    this.heartbeat = null

    const restore = (): void => {
      this.queue.unshift(...logs)
      if (snapshot) this.snapshots.unshift(snapshot)
      this.heartbeat ??= heartbeat
    }

    this.flushing = true
    let ok = false
    try {
      const response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(this.buildBody(logs, snapshot, heartbeat))
      })
      if (response.ok) {
        ok = true
      } else if (response.status === 401) {
        // Signed out: hold everything until setEnabled(true) is called again
        this.authBlocked = true
        restore()
      } else if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        // The server rejected this batch and would again; drop it rather
        // than block everything behind it.
        ok = true
      } else {
        restore()
      }
    } catch {
      restore()
    } finally {
      this.flushing = false
    }

    if (ok) {
      this.failures = 0
      if (this.hasPersisted) this.persist()
      if (this.hasWork()) this.scheduleFlush(500)
      else this.scheduleHeldRelease()
    } else if (!this.authBlocked) {
      this.failures++
      this.persist()
      this.scheduleFlush(
        Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.failures - 1))
      )
    } else {
      this.persist()
    }
  }

  /**
   * Best-effort delivery when the page is hidden or closed. Whatever doesn't
   * fit in one beacon is kept in localStorage for the next page load.
   */
  flushOnUnload(): void {
    // Held repeat counts would otherwise be lost with the page
    this.releaseHeld(this.now(), true)
    if (!this.enabled || this.authBlocked) return
    if (this.queue.length === 0 && !this.heartbeat) return
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
      this.persist()
      return
    }

    const logs: RemoteLogEntry[] = []
    let size = 0
    for (const entry of this.queue) {
      size += safeStringify(entry).length
      if (size > MAX_BEACON_BYTES || logs.length >= BATCH_SIZE) break
      logs.push(entry)
    }

    const body = JSON.stringify(this.buildBody(logs, undefined, this.heartbeat))
    const sent = navigator.sendBeacon(
      this.endpoint,
      new Blob([body], { type: 'application/json' })
    )
    if (sent) {
      this.queue.splice(0, logs.length)
      this.heartbeat = null
    }
    this.persist()
  }

  private buildBody(
    logs: RemoteLogEntry[],
    snapshot: RemoteSnapshot | undefined,
    heartbeat: RemoteHeartbeat | null
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      sessionId: this.sessionId,
      appVersion: this.appVersion
    }
    const page = currentPath()
    if (page) body.page = page
    if (logs.length > 0) body.logs = logs
    if (snapshot) body.snapshot = snapshot
    if (heartbeat) body.heartbeat = heartbeat
    return body
  }

  /**
   * Queues the repeat rows whose window has closed (all of them when forced)
   * and forgets lines that have stopped repeating.
   */
  private releaseHeld(now: number, force = false): void {
    this.repeats.forEach((repeat, key) => {
      if (!force && now - repeat.windowStart < REPEAT_WINDOW_MS) return
      if (!repeat.held) {
        this.repeats.delete(key)
        return
      }
      this.queue.push(repeat.entry)
      if (this.queue.length > MAX_QUEUE) {
        this.queue.splice(0, this.queue.length - MAX_QUEUE)
      }
      // The released row opens the next window
      repeat.held = false
      repeat.windowStart = now
    })
  }

  private scheduleHeldRelease(): void {
    let earliest: number | null = null
    this.repeats.forEach((repeat) => {
      if (!repeat.held) return
      const dueAt = repeat.windowStart + REPEAT_WINDOW_MS
      if (earliest === null || dueAt < earliest) earliest = dueAt
    })
    if (earliest === null) return
    this.scheduleFlush(Math.max(0, earliest - this.now()) + 50)
  }

  private hasWork(): boolean {
    return (
      this.queue.length > 0 ||
      this.snapshots.length > 0 ||
      this.heartbeat !== null
    )
  }

  private scheduleFlush(delayMs: number): void {
    if (!this.autoFlush || !this.enabled || this.authBlocked) return
    const dueAt = Date.now() + delayMs
    if (this.flushTimer) {
      if (this.flushDueAt <= dueAt) return
      clearTimeout(this.flushTimer)
    }
    this.flushDueAt = dueAt
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, delayMs)
  }

  // Snapshots are not persisted: they are large and describe a page state
  // that no longer exists after a reload. The log lines are what matter.
  private persist(): void {
    if (!this.storage) return
    try {
      if (this.queue.length === 0) {
        this.storage.removeItem(STORAGE_KEY)
        this.hasPersisted = false
        return
      }
      const entries = this.queue.map((entry) => ({
        ...entry,
        sid: entry.sid ?? this.sessionId
      }))
      this.storage.setItem(STORAGE_KEY, JSON.stringify(entries))
      this.hasPersisted = true
    } catch {
      // Storage full or unavailable: the in-memory queue still stands
    }
  }

  private restore(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return
      this.storage.removeItem(STORAGE_KEY)
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      for (const item of parsed.slice(-MAX_QUEUE) as unknown[]) {
        if (isRemoteLogEntry(item)) {
          this.queue.push({ ...item, seq: this.nextSeq++ })
        }
      }
    } catch {
      // Corrupt payload: nothing worth recovering
    }
  }
}

function isRemoteLogEntry(value: unknown): value is RemoteLogEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.ts === 'string' &&
    typeof entry.message === 'string' &&
    typeof entry.repeatCount === 'number' &&
    (entry.level === 'INFO' ||
      entry.level === 'WARN' ||
      entry.level === 'ERROR')
  )
}

export const remoteLogShipper = new RemoteLogShipper()
