'use client'

import type { HealthStatus } from '@/shared/types/health'
import { CollapsibleSection } from '../diagnostic-components'
import { StatusField } from '../diagnostic-components'

interface QueueInformationSectionProps {
  healthStatus: HealthStatus
  hasErrors: boolean
}

export function QueueInformationSection({
  healthStatus,
  hasErrors
}: QueueInformationSectionProps): JSX.Element | null {
  if (!healthStatus.queueState) {
    return null
  }

  const severity =
    healthStatus.queueState.isEmpty
      ? 'warning'
      : !healthStatus.queueState.hasNextTrack
        ? 'warning'
        : 'info'

  return (
    <CollapsibleSection
      title='Queue Information'
      defaultExpanded={!hasErrors}
      severity={severity}
    >
      <div className='space-y-2'>
        <div className='grid grid-cols-2 gap-4'>
          <StatusField
            label='Queue Length'
            value={`${healthStatus.queueState.queueLength} tracks`}
          />
          <StatusField
            label='Status'
            value={
              healthStatus.queueState.isEmpty
                ? 'Empty'
                : healthStatus.queueState.hasNextTrack
                  ? 'Ready'
                  : 'No next track'
            }
          />
        </div>
        {healthStatus.queueState.nextTrack ? (
          <div className='rounded border border-gray-700 bg-gray-800/50 p-3'>
            <p className='text-xs text-gray-400'>Next Track</p>
            <p className='text-white text-sm font-medium'>
              {healthStatus.queueState.nextTrack.name}
            </p>
            <p className='text-xs text-gray-300'>
              {healthStatus.queueState.nextTrack.artist}
            </p>
          </div>
        ) : (
          <div className='rounded border border-yellow-500/50 bg-yellow-900/20 p-3'>
            <p className='text-sm text-yellow-200'>No next track in queue</p>
          </div>
        )}
      </div>
    </CollapsibleSection>
  )
}

