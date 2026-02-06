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

        {healthStatus.internalState?.internalLogs &&
          healthStatus.internalState.internalLogs.length > 0 && (
            <div>
              <p className='mb-2 text-xs text-gray-400'>
                Internal Logs ({healthStatus.internalState.internalLogs.length})
              </p>
              <div className='max-h-60 overflow-y-auto rounded bg-black/30 p-2 text-xs font-mono'>
                <div className='flex flex-col gap-1'>
                  {healthStatus.internalState.internalLogs.map((log, i) => (
                    <div key={i} className='flex gap-2 text-gray-300'>
                      <span className='shrink-0 text-gray-500'>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span
                        className={
                          log.level === 'ERROR'
                            ? 'text-red-400'
                            : log.level === 'WARN'
                              ? 'text-yellow-400'
                              : 'text-blue-400'
                        }
                      >
                        [{log.level}]
                      </span>
                      <span className='break-all'>{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
      </div>
    </CollapsibleSection>
  )
}
