import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import {
  withRetry,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG
} from '@/shared/utils/supabaseRetry'

type SupabaseClientType = SupabaseClient<Database>

/**
 * Helper function to execute a SELECT query with retry logic
 */
export async function selectWithRetry<T = unknown>(
  client: SupabaseClientType,
  table: string,
  queryBuilder: (
    builder: ReturnType<SupabaseClientType['from']>
  ) => PromiseLike<{ data: T | null; error: unknown }>,
  retryConfig?: RetryConfig,
  queryName?: string
): Promise<{ data: T | null; error: unknown }> {
  return withRetry(
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder = client.from(table as any)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const query = queryBuilder(builder)
      return await query
    },
    retryConfig,
    queryName ?? `SELECT from ${table}`
  )
}

/**
 * Helper function to execute an INSERT query with retry logic
 */
export async function insertWithRetry<T = unknown>(
  client: SupabaseClientType,
  table: string,
  values: unknown,
  retryConfig?: RetryConfig,
  queryName?: string
): Promise<{ data: T | null; error: unknown }> {
  return withRetry(
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await client.from(table as any).insert(values)
    },
    retryConfig,
    queryName ?? `INSERT into ${table}`
  )
}

/**
 * Helper function to execute an UPDATE query with retry logic
 */
export async function updateWithRetry<T = unknown>(
  client: SupabaseClientType,
  table: string,
  queryBuilder: (
    builder: ReturnType<SupabaseClientType['from']>
  ) => PromiseLike<{ data: T | null; error: unknown }>,
  retryConfig?: RetryConfig,
  queryName?: string
): Promise<{ data: T | null; error: unknown }> {
  return withRetry(
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder = client.from(table as any)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const query = queryBuilder(builder)
      return await query
    },
    retryConfig,
    queryName ?? `UPDATE ${table}`
  )
}

/**
 * Helper function to execute an UPSERT query with retry logic
 */
export async function upsertWithRetry<T = unknown>(
  client: SupabaseClientType,
  table: string,
  values: unknown,
  options?: { onConflict?: string },
  retryConfig?: RetryConfig,
  queryName?: string
): Promise<{ data: T | null; error: unknown }> {
  return withRetry(
    async () => {
      const upsertOptions = options?.onConflict
        ? { onConflict: options.onConflict }
        : undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await client.from(table as any).upsert(values, upsertOptions)
    },
    retryConfig,
    queryName ?? `UPSERT into ${table}`
  )
}

/**
 * Helper function to execute a DELETE query with retry logic
 */
export async function deleteWithRetry<T = unknown>(
  client: SupabaseClientType,
  table: string,
  queryBuilder: (builder: ReturnType<SupabaseClientType['from']>) => {
    delete: () => PromiseLike<{ data: T | null; error: unknown }>
  },
  retryConfig?: RetryConfig,
  queryName?: string
): Promise<{ data: T | null; error: unknown }> {
  return withRetry(
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder = client.from(table as any)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const query = queryBuilder(builder)
      return await query.delete()
    },
    retryConfig,
    queryName ?? `DELETE from ${table}`
  )
}

/**
 * Helper function to execute an RPC call with retry logic
 */
export async function rpcWithRetry<T = unknown>(
  client: SupabaseClientType,
  functionName: string,
  params?: Record<string, unknown>,
  retryConfig?: RetryConfig,
  queryName?: string
): Promise<{ data: T | null; error: unknown }> {
  return withRetry(
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await client.rpc(functionName as any, params ?? {})
      return {
        data: (result.data as T | null) ?? null,
        error: result.error
      }
    },
    retryConfig,
    queryName ?? `RPC ${functionName}`
  )
}

/**
 * Helper function to execute a query builder chain with retry logic
 * This is a more flexible wrapper that can handle any query builder pattern
 * Accepts either a Promise or a PostgrestBuilder (query builder chain)
 */
export async function queryWithRetry<T = unknown>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
  retryConfig?: RetryConfig,
  queryName?: string
): Promise<{ data: T | null; error: unknown; count?: number | null }> {
  return withRetry(
    async () => {
      return await query
    },
    retryConfig,
    queryName ?? 'Supabase query'
  )
}

export { DEFAULT_RETRY_CONFIG, type RetryConfig }
