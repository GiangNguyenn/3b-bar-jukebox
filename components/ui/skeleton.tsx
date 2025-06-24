import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
  width?: string | number
  height?: string | number
}

export function Skeleton({
  className,
  variant = 'rectangular',
  width,
  height
}: SkeletonProps): JSX.Element {
  const baseClasses = 'animate-pulse bg-gray-700'

  const variantClasses = {
    text: 'h-4 rounded',
    circular: 'rounded-full',
    rectangular: 'rounded'
  }

  const style = {
    width: width,
    height: height
  }

  return (
    <div
      className={cn(baseClasses, variantClasses[variant], className)}
      style={style}
    />
  )
}

// Pre-built skeleton components for common patterns
export function TrackSkeleton(): JSX.Element {
  return (
    <div className='flex items-center space-x-4 p-4'>
      <Skeleton variant='circular' width={40} height={40} />
      <div className='flex-1 space-y-2'>
        <Skeleton variant='text' width='60%' />
        <Skeleton variant='text' width='40%' />
      </div>
    </div>
  )
}

export function PlaylistSkeleton(): JSX.Element {
  return (
    <div className='space-y-4'>
      {Array.from({ length: 5 }).map((_, i) => (
        <TrackSkeleton key={i} />
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <div className='space-y-2'>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className='flex items-center space-x-4 p-3'>
          <Skeleton variant='text' width={20} />
          <Skeleton variant='text' width='30%' />
          <Skeleton variant='text' width='25%' />
          <Skeleton variant='text' width='25%' />
          <Skeleton variant='text' width={60} />
          <Skeleton variant='text' width={80} />
        </div>
      ))}
    </div>
  )
}
