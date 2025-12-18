import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

export function useTrackGenre(
  trackId: string | undefined,
  fallbackGenre?: string | null
) {
  const [genre, setGenre] = useState<string | null>(fallbackGenre ?? null)
  const [loading, setLoading] = useState(false)

  // Create Supabase client
  const supabase = useMemo(
    () =>
      createBrowserClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )

  useEffect(() => {
    // If we have a fallback genre, use it and don't fetch unless it's null
    if (fallbackGenre) {
      setGenre(fallbackGenre)
      return
    }

    if (!trackId) {
      setGenre(null)
      return
    }

    let isMounted = true
    setLoading(true)

    const fetchGenre = async () => {
      try {
        const { data, error } = await supabase
          .from('tracks')
          .select('genre')
          .eq('spotify_track_id', trackId)
          .maybeSingle()

        if (isMounted) {
          if (!error && data?.genre) {
            setGenre(data.genre)
          } else {
            setGenre(null)
          }
        }
      } catch (error) {
        console.error('Error fetching track genre:', error)
        if (isMounted) setGenre(null)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void fetchGenre()

    return () => {
      isMounted = false
    }
  }, [trackId, fallbackGenre, supabase])

  return { genre, loading }
}
