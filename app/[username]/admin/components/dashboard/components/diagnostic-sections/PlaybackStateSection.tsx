'use client'

import type { HealthStatus } from '@/shared/types/health'
import { formatDuration } from '@/lib/utils'
import { CollapsibleSection } from '../diagnostic-components'
import { StatusField } from '../diagnostic-components'

interface PlaybackStateSectionProps {
  healthStatus: HealthStatus
  hasErrors: boolean
}

export function PlaybackStateSection({
  healthStatus,
  hasErrors
}: PlaybackStateSectionProps): JSX.Element | null {
  if (!healthStatus.playbackDetails) {
    return null
  }

  const severity = healthStatus.playbackDetails.isStalled
    ? 'error'
    : !healthStatus.playbackDetails.isPlaying
      ? 'warning'
      : 'info'

  return (
    <CollapsibleSection
      title='Playback State'
      defaultExpanded={!hasErrors}
      severity={severity}
    >
      {healthStatus.playbackDetails.currentTrack ? (
        <div className='space-y-2'>
          <div>
            <p className='text-xs text-gray-400'>Current Track</p>
            <p className='text-white text-sm font-medium'>
              {healthStatus.playbackDetails.currentTrack.name}
            </p>
            <p className='text-xs text-gray-300'>
              {healthStatus.playbackDetails.currentTrack.artist}
            </p>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <StatusField
              label='Progress'
              value={`${formatDuration(healthStatus.playbackDetails.progress)} / ${formatDuration(healthStatus.playbackDetails.duration)}`}
            />
            <StatusField
              label='Status'
              value={
                <>
                  {healthStatus.playbackDetails.isPlaying
                    ? 'Playing'
                    : 'Paused'}
                  {healthStatus.playbackDetails.isStalled && ' (Stalled)'}
                </>
              }
            />
          </div>
        </div>
      ) : (
        <p className='text-sm text-gray-400'>No track currently playing</p>
      )}
    </CollapsibleSection>
  )
}
