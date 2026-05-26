import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// In Node.js environments (tests), @supabase/realtime-js requires an explicit
// WebSocket transport since Node.js 20 has no native WebSocket global.
const realtimeOptions =
  typeof window === 'undefined'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      { transport: require('ws') as typeof WebSocket }
    : {}

export const supabaseBrowser = createBrowserClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  { realtime: realtimeOptions }
)
