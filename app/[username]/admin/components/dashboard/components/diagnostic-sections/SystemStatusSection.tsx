'use client'

import type { HealthStatus } from '@/shared/types/health'
import type { PlayerStatus } from '@/hooks/useSpotifyPlayer'
import { CollapsibleSection } from '../diagnostic-components'
import { StatusField } from '../diagnostic-components'

interface SystemStatusSectionProps {
  healthStatus: HealthStatus
  playerStatus?: PlayerStatus
  isReady: boolean
  hasErrors: boolean
  overallSeverity: 'error' | 'warning' | 'info'
}

export function SystemStatusSection({
  healthStatus,
  playerStatus,
  isReady,
  hasErrors,
  overallSeverity
}: SystemStatusSectionProps): JSX.Element {
  return (
    <CollapsibleSection
      title='System Status'
      defaultExpanded={!hasErrors}
      severity={overallSeverity}
    >
      <div className='grid grid-cols-2 gap-4'>
        <StatusField
          label='Player Status'
          value={playerStatus ?? (isReady ? 'ready' : 'initializing')}
        />
        <StatusField label='Device Status' value={healthStatus.device} />
        <StatusField label='Playback Status' value={healthStatus.playback} />
        <StatusField
          label='Token Status'
          value={
            <>
              {healthStatus.token}
              {healthStatus.tokenExpiringSoon && ' (expiring soon)'}
            </>
          }
        />
        <StatusField label='Connection' value={healthStatus.connection} />
        {healthStatus.deviceId && (
          <StatusField
            label='Device ID'
            value={
              <span className='font-mono text-xs text-gray-300'>
                {healthStatus.deviceId.slice(0, 20)}...
              </span>
            }
          />
        )}
      </div>
    </CollapsibleSection>
  )
}
