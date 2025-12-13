import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import type { TrackDetails } from '@/shared/types/spotify'

const logger = createModuleLogger('LazyUpdateQueue')

type LazyUpdateType =
  | 'artist_profile'
  | 'artist_top_tracks'
  | 'track_details'
  | 'track_unavailable'

interface LazyUpdatePayload {
  type: LazyUpdateType
  spotifyId: string
  payload?: Record<string, unknown>
}

export interface LazyUpdateRecord extends LazyUpdatePayload {
  id: string
  attempts: number
  status: 'pending' | 'processing' | 'failed' | 'completed'
  updated_at?: string
}

const lazyTable = () =>
  supabase.from('spotify_lazy_updates' as never) as unknown as {
    upsert: (
      values: Record<string, unknown>,
      opts?: { onConflict?: string }
    ) => Promise<{ error: unknown }>
    select: (columns: string) => any
    update: (values: Record<string, unknown>) => any
  }

function dedupeKey(type: LazyUpdateType, spotifyId: string): string {
  return `${type}:${spotifyId}`
}

export async function enqueueLazyUpdate(
  update: LazyUpdatePayload
): Promise<void> {
  try {
    const { error } = await lazyTable().upsert(
      {
        dedupe_key: dedupeKey(update.type, update.spotifyId),
        type: update.type,
        spotify_id: update.spotifyId,
        payload: update.payload ?? {},
        status: 'pending',
        attempts: 0
      } as any,
      { onConflict: 'dedupe_key' }
    )

    if (error) {
      logger(
        'WARN',
        `Failed to enqueue lazy update ${update.type} for ${update.spotifyId}`,
        'enqueueLazyUpdate',
        error as Error
      )
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception enqueueing lazy update ${update.type} for ${update.spotifyId}`,
      'enqueueLazyUpdate',
      error instanceof Error ? error : undefined
    )
  }
}

export async function fetchPendingLazyUpdates(
  limit: number
): Promise<LazyUpdateRecord[]> {
  try {
    const { data, error } = await lazyTable()
      .select('id,type,spotify_id,payload,attempts,status,updated_at')
      .eq('status', 'pending')
      .order('updated_at', { ascending: true, nullsFirst: true })
      .limit(limit)

    if (error) {
      logger('WARN', 'Failed to fetch lazy updates', 'fetchPendingLazyUpdates')
      return []
    }

    return (
      data?.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        type: row.type as LazyUpdateType,
        spotifyId: row.spotify_id as string,
        payload: (row.payload as Record<string, unknown>) ?? {},
        attempts: (row.attempts as number) ?? 0,
        status: row.status as LazyUpdateRecord['status'],
        updated_at: row.updated_at as string | undefined
      })) ?? []
    )
  } catch (error) {
    logger(
      'WARN',
      'Exception fetching lazy updates',
      'fetchPendingLazyUpdates',
      error instanceof Error ? error : undefined
    )
    return []
  }
}

export async function markLazyUpdateResult(
  id: string,
  status: 'pending' | 'failed' | 'completed',
  attempts: number,
  errorMessage?: string
): Promise<void> {
  try {
    const { error } = await lazyTable()
      .update({
        status,
        attempts,
        error_message: errorMessage,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (error) {
      logger(
        'WARN',
        `Failed to mark lazy update ${id} as ${status}`,
        'markLazyUpdateResult',
        error as Error
      )
    }
  } catch (error) {
    logger(
      'WARN',
      'Exception marking lazy update result',
      'markLazyUpdateResult',
      error instanceof Error ? error : undefined
    )
  }
}

export async function markLazyUpdateProcessing(ids: string[]): Promise<void> {
  if (!ids.length) return
  try {
    const { error } = await lazyTable()
      .update({
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .in('id', ids)

    if (error) {
      logger(
        'WARN',
        `Failed to mark ${ids.length} lazy updates processing`,
        'markLazyUpdateProcessing',
        error as Error
      )
    }
  } catch (error) {
    logger(
      'WARN',
      'Exception marking lazy updates processing',
      'markLazyUpdateProcessing',
      error instanceof Error ? error : undefined
    )
  }
}

export function extractTrackDetailsFromPayload(
  payload?: Record<string, unknown>
): TrackDetails[] {
  if (!payload || !Array.isArray(payload.tracks)) return []
  return payload.tracks as TrackDetails[]
}

export function extractTrackIdsFromPayload(
  payload?: Record<string, unknown>
): string[] {
  if (!payload || !Array.isArray(payload.trackIds)) return []
  return payload.trackIds as string[]
}
