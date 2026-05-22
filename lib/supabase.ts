export { supabaseBrowser as supabase } from './supabase-browser'

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
