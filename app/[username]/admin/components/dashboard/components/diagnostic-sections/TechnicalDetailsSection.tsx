'use client'

import type { HealthStatus } from '@/shared/types/health'
import { formatRelativeTime } from '@/lib/utils'
import { CollapsibleSection } from '../diagnostic-components'
import { StatusField } from '../diagnostic-components'

interface TechnicalDetailsSectionProps {
  healthStatus: HealthStatus
  currentPlayerStatus: string
}

export function TechnicalDetailsSection({
  healthStatus,
  currentPlayerStatus
}: TechnicalDetailsSectionProps): JSX.Element {
  return (
    <CollapsibleSection
      title='Technical Details'
      defaultExpanded={false}
      severity='info'
    >
      <div className='space-y-3'>
        <StatusField
          label='Player Status'
          value={<span className='font-mono'>{currentPlayerStatus}</span>}
        />
        {healthStatus.failureMetrics && (
          <div>
            <p className='text-xs text-gray-400'>Failure Metrics</p>
            <div className='mt-1 space-y-1'>
              <p className='text-xs text-gray-300'>
                Consecutive Failures:{' '}
                {healthStatus.failureMetrics.consecutiveFailures}
              </p>
              {healthStatus.failureMetrics.lastSuccessfulOperation && (
                <p className='text-xs text-gray-300'>
                  Last Recovery:{' '}
                  {formatRelativeTime(
                    healthStatus.failureMetrics.lastSuccessfulOperation
                  )}
                </p>
              )}
              {healthStatus.failureMetrics.lastFailureTimestamp && (
                <p className='text-xs text-gray-300'>
                  Last Failure:{' '}
                  {formatRelativeTime(
                    healthStatus.failureMetrics.lastFailureTimestamp
                  )}
                </p>
              )}
            </div>
          </div>
        )}
        {healthStatus.deviceId && (
          <div>
            <p className='text-xs text-gray-400'>Full Device ID</p>
            <p className='break-all font-mono text-xs text-gray-300'>
              {healthStatus.deviceId}
            </p>
          </div>
        )}
      </div>
    </CollapsibleSection>
  )
}
