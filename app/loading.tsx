import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGear } from '@fortawesome/free-solid-svg-icons'

export default function Loading(): JSX.Element {
  return (
    <div className='relative flex h-screen items-center justify-center bg-[var(--color-bg)]'>
      <FontAwesomeIcon className='h-16 w-16 animate-spin' icon={faGear} />
    </div>
  )
}
