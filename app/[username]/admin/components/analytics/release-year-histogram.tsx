'use client'

import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import { Loading } from '@/components/ui/loading'
import { ErrorMessage } from '@/components/ui/error-message'
import { createBrowserClient } from '@supabase/ssr'
import { type Database } from '@/types/supabase'

interface HistogramData {
  decade: string
  track_count: number
}

export default function ReleaseYearHistogram(): JSX.Element {
  const [data, setData] = useState<HistogramData[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const fetchHistogramData = async (): Promise<void> => {
      try {
        setIsLoading(true)
        const {
          data: { session }
        } = await supabase.auth.getSession()

        if (!session) {
          throw new Error('Not authenticated')
        }

        const response = await supabase.rpc(
          'get_track_release_year_histogram',
          {
            p_user_id: session.user.id
          }
        )

        if (response.error) {
          throw new Error(response.error.message)
        }

        setData(response.data as HistogramData[])
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : 'An unknown error occurred'
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    void fetchHistogramData()
  }, [supabase])

  if (error) return <ErrorMessage message='Failed to load release year data.' />
  if (isLoading) return <Loading />

  return (
    <ResponsiveContainer width='100%' height={400}>
      <BarChart
        data={data}
        margin={{
          top: 20,
          right: 30,
          left: 20,
          bottom: 5
        }}
      >
        <CartesianGrid strokeDasharray='3 3' />
        <XAxis dataKey='decade' />
        <YAxis />
        <Tooltip />
        <Bar dataKey='track_count' fill='#8884d8' />
      </BarChart>
    </ResponsiveContainer>
  )
}
