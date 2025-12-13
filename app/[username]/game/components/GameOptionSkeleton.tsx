'use client'

import { Skeleton } from '@/components/ui'

export function GameOptionSkeleton(): JSX.Element {
  return (
    <div className='relative flex h-full w-full flex-col items-start justify-between rounded-xl border border-gray-700 bg-gray-900/70 px-3 py-2'>
      <div className='w-full'>
        <Skeleton variant='text' className='mb-2 h-5 w-4/5' />
        <Skeleton variant='text' className='h-4 w-3/4' />
      </div>
      <div className='mt-2 flex w-full items-center justify-between'>
        <Skeleton variant='text' className='h-3 w-24' />
      </div>
    </div>
  )
}
