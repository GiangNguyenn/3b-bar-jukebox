import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// Export retry utilities
export {
  withRetry,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig
} from '@/shared/utils/supabaseRetry'

export {
  selectWithRetry,
  insertWithRetry,
  updateWithRetry,
  upsertWithRetry,
  deleteWithRetry,
  rpcWithRetry,
  queryWithRetry
} from './supabaseQuery'
