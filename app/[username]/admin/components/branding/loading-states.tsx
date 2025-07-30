'use client'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function BrandingSettingsSkeleton(): JSX.Element {
  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-8 w-48' />
        <Skeleton className='h-10 w-32' />
      </div>

      <div className='grid grid-cols-5 gap-4'>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className='h-10 w-full' />
        ))}
      </div>

      <div className='space-y-4'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className='p-6'>
            <Skeleton className='mb-4 h-6 w-32' />
            <div className='space-y-4'>
              <Skeleton className='h-4 w-full' />
              <Skeleton className='h-4 w-3/4' />
              <Skeleton className='h-4 w-1/2' />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function FileUploadSkeleton(): JSX.Element {
  return (
    <div className='space-y-4'>
      <Skeleton className='h-4 w-24' />
      <Skeleton className='h-10 w-full' />
      <Skeleton className='h-4 w-64' />
    </div>
  )
}

export function BrandingSectionSkeleton(): JSX.Element {
  return (
    <Card className='p-6'>
      <Skeleton className='mb-4 h-6 w-32' />
      <div className='space-y-4'>
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-3/4' />
        <Skeleton className='h-4 w-1/2' />
      </div>
    </Card>
  )
}
