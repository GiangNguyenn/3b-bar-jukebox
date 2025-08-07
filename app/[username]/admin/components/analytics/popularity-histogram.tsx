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
  popularity_range: string
  track_count: number
}

// Custom tooltip component for popularity descriptions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any): JSX.Element | null => {
  if (active && payload && Array.isArray(payload) && payload.length > 0) {
    const getPopularityDescription = (range: string): string => {
      switch (range) {
        case '0-19':
          return 'Very obscure/niche tracks - underground or experimental music'
        case '20-39':
          return 'Low to mid-tier popularity - known within specific communities'
        case '40-59':
          return 'Popular, frequently streamed tracks - well-known songs'
        case '60-79':
          return 'Very popular tracks and hits - mainstream success'
        case '80-100':
          return 'Major hits and viral tracks - global megahits'
        default:
          return 'Unknown popularity range'
      }
    }

    return (
      <div
        className='bg-white rounded border p-3 opacity-100 shadow-lg'
        style={{ backgroundColor: 'white' }}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-unsafe-argument */}
        <p className='font-semibold text-black'>{`Popularity: ${label}`}</p>
        {/* eslint-disable-next-line @typescript-eslint/no-unsafe-argument */}
        <p className='text-sm text-gray-600'>
          {getPopularityDescription(label)}
        </p>
        {/* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */}
        <p className='text-sm font-medium text-black'>{`Tracks: ${(payload as any)[0]?.value}`}</p>
      </div>
    )
  }
  return null
}

export default function PopularityHistogram(): JSX.Element {
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

        const response = await supabase.rpc('get_track_popularity_histogram', {
          p_user_id: session.user.id
        })

        if (response.error) {
          throw new Error(response.error.message)
        }

        // Sort the data to ensure proper order from lowest to highest popularity
        const sortedData = (response.data as HistogramData[]).sort((a, b) => {
          const getOrder = (range: string): number => {
            switch (range) {
              case '0-19':
                return 1
              case '20-39':
                return 2
              case '40-59':
                return 3
              case '60-79':
                return 4
              case '80-100':
                return 5
              default:
                return 6
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          return getOrder(a.popularity_range) - getOrder(b.popularity_range)
        })
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        setData(sortedData)
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const errorMessage =
          err instanceof Error ? err.message : 'An unknown error occurred'
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    void fetchHistogramData()
  }, [supabase])

  if (error) return <ErrorMessage message='Failed to load popularity data.' />
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
        <XAxis dataKey='popularity_range' />
        <YAxis />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey='track_count' fill='#82ca9d' />
      </BarChart>
    </ResponsiveContainer>
  )
}
