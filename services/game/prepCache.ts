import { randomUUID } from 'crypto'

type PrepStatus = 'ready' | 'warming' | 'failed'

interface PrepJob<T> {
  id: string
  key: string
  status: PrepStatus
  payload?: T
  error?: string
  expiresAt: number
}

// In-memory cache (per serverless instance). TTL is short; caller should expect cache misses across instances.
const prepStore = new Map<string, PrepJob<unknown>>()

export function createPrepJobKey(parts: string[]): string {
  return parts.join('|')
}

export function createPrepJob<T>(key: string, ttlMs: number): PrepJob<T> {
  const job: PrepJob<T> = {
    id: randomUUID(),
    key,
    status: 'warming',
    expiresAt: Date.now() + ttlMs
  }
  prepStore.set(job.id, job)
  return job
}

export function markPrepReady<T>(
  jobId: string,
  payload: T,
  ttlMs: number
): PrepJob<T> | undefined {
  const existing = prepStore.get(jobId) as PrepJob<T> | undefined
  if (!existing) return undefined
  const updated: PrepJob<T> = {
    ...existing,
    status: 'ready',
    payload,
    expiresAt: Date.now() + ttlMs
  }
  prepStore.set(jobId, updated)
  return updated
}

export function markPrepFailed(
  jobId: string,
  error?: string
): PrepJob<unknown> | undefined {
  const existing = prepStore.get(jobId)
  if (!existing) return undefined
  const updated: PrepJob<unknown> = {
    ...existing,
    status: 'failed',
    error,
    expiresAt: existing.expiresAt
  }
  prepStore.set(jobId, updated)
  return updated
}

export function getPrepJob<T>(jobId: string): PrepJob<T> | undefined {
  const job = prepStore.get(jobId) as PrepJob<T> | undefined
  if (!job) return undefined
  if (job.expiresAt < Date.now()) {
    prepStore.delete(jobId)
    return undefined
  }
  return job
}

export function findReadyJobByKey<T>(key: string): PrepJob<T> | undefined {
  for (const job of Array.from(prepStore.values())) {
    if (
      job.key === key &&
      job.status === 'ready' &&
      job.expiresAt > Date.now()
    ) {
      return job as PrepJob<T>
    }
  }
  return undefined
}
