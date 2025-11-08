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

// Custom tooltip component for release year descriptions
const CustomTooltip = ({
  active,
  payload,
  label
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}): JSX.Element | null => {
  if (active && payload && Array.isArray(payload) && payload.length > 0) {
    const getDecadeDescription = (decade: string): string => {
      switch (decade) {
        case '1960s':
          return 'Classic rock, Motown, and the British Invasion'
        case '1970s':
          return 'Disco, progressive rock, and classic rock hits'
        case '1980s':
          return 'New wave, synth-pop, and classic rock anthems'
        case '1990s':
          return 'Alternative rock, grunge, and hip-hop golden age'
        case '2000s':
          return 'Pop-punk, emo, and early digital music era'
        case '2010s':
          return 'Indie pop, electronic, and streaming era hits'
        case '2020s':
          return 'Current hits, viral tracks, and modern pop'
        default:
          return 'Music from this era'
      }
    }

    return (
      <div
        className='bg-white rounded border p-3 opacity-100 shadow-lg'
        style={{ backgroundColor: 'white' }}
      >
        <p className='font-semibold text-black'>{`Decade: ${label}`}</p>
        <p className='text-sm text-gray-600'>
          {getDecadeDescription(label ?? '')}
        </p>
        <p className='text-sm font-medium text-black'>{`Songs: ${payload[0]?.value ?? 0}`}</p>
      </div>
    )
  }
  return null
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
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey='track_count' fill='#8884d8' />
      </BarChart>
    </ResponsiveContainer>
  )
}
