'use client'

import type { HealthStatus } from '@/shared/types/health'
import { formatRelativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { CollapsibleSection } from '../diagnostic-components'
import { getSeverityStyles, formatEventType } from '../diagnostic-utils'

interface RecentEventsSectionProps {
  healthStatus: HealthStatus
  hasErrors: boolean
}

export function RecentEventsSection({
  healthStatus,
  hasErrors
}: RecentEventsSectionProps): JSX.Element | null {
  if (!healthStatus.recentEvents || healthStatus.recentEvents.length === 0) {
    return null
  }

  return (
    <CollapsibleSection
      title='Recent Events'
      defaultExpanded={hasErrors}
      severity={hasErrors ? 'error' : 'info'}
    >
      <div className='max-h-64 space-y-2 overflow-y-auto'>
        {healthStatus.recentEvents.map((event) => (
          <div
            key={`${event.timestamp}-${event.type}`}
            className={cn(
              'rounded border p-2',
              getSeverityStyles(event.severity ?? 'info')
            )}
          >
            <div className='flex items-start justify-between'>
              <div className='flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='text-xs font-medium text-gray-400'>
                    {formatEventType(event.type)}
                  </span>
                  {event.severity && (
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs',
                        event.severity === 'error'
                          ? 'bg-red-500/20 text-red-200'
                          : event.severity === 'warning'
                            ? 'bg-yellow-500/20 text-yellow-200'
                            : 'bg-blue-500/20 text-blue-200'
                      )}
                    >
                      {event.severity}
                    </span>
                  )}
                </div>
                <p className='text-white mt-1 text-sm'>{event.message}</p>
                {event.details && Object.keys(event.details).length > 0 && (
                  <details className='mt-2'>
                    <summary className='cursor-pointer text-xs text-gray-400'>
                      Details
                    </summary>
                    <pre className='mt-1 overflow-x-auto text-xs text-gray-300'>
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
              <span className='ml-2 whitespace-nowrap text-xs text-gray-500'>
                {formatRelativeTime(event.timestamp)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  )
}
