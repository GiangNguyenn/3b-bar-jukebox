import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGear } from '@fortawesome/free-solid-svg-icons'
import { cn } from '@/lib/utils'

interface LoadingProps {
  className?: string
  fullScreen?: boolean
  message?: string
}

export function Loading({
  className,
  fullScreen = false,
  message
}: LoadingProps): JSX.Element {
  const gear = (
    <FontAwesomeIcon
      className={cn('h-8 w-8 animate-spin', className)}
      icon={faGear}
    />
  )

  const content = (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4',
        className
      )}
    >
      {gear}
      {message && (
        <p className='text-center text-sm text-gray-400'>{message}</p>
      )}
    </div>
  )

  if (fullScreen) {
    return (
      <div className='relative flex h-screen items-center justify-center bg-background'>
        {content}
      </div>
    )
  }

  return content
}
