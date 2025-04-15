'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GenresSelector } from '../genres/genres-selector'

export function TrackSuggestionsTab(): JSX.Element {
  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='text-2xl font-bold'>Track Suggestions</h2>
      </div>

      <div className='grid gap-6 md:grid-cols-2'>
        <GenresSelector />

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-gray-400'>No upcoming suggestions</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
