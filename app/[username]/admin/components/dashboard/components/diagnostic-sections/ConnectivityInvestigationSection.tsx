'use client'

import type { HealthStatus } from '@/shared/types/health'
import type { FailedRequestInfo } from '@/shared/types/connectivity'
import { CollapsibleSection } from '../diagnostic-components'
import { formatAbsoluteTime } from '@/lib/utils'

interface ConnectivityInvestigationSectionProps {
  healthStatus: HealthStatus
  hasErrors: boolean
}

export function ConnectivityInvestigationSection({
  healthStatus,
  hasErrors
}: ConnectivityInvestigationSectionProps): JSX.Element | null {
  const investigation = healthStatus.connectivityInvestigation

  // Don't render if no investigation data
  if (
    !investigation ||
    (investigation.recentFailures.length === 0 &&
      !investigation.lastInvestigation)
  ) {
    return null
  }

  const { lastInvestigation, recentFailures, protocolStatus, suspectedIssues } =
    investigation

  // Determine severity based on issues
  const severity: 'error' | 'warning' | 'info' =
    suspectedIssues.length > 0 ? (hasErrors ? 'error' : 'warning') : 'info'

  return (
    <CollapsibleSection
      title='Connectivity Investigation'
      defaultExpanded={suspectedIssues.length > 0}
      severity={severity}
    >
      <div className='space-y-4'>
        {/* Protocol Status */}
        <div>
          <h4 className='mb-2 text-sm font-medium text-gray-300'>
            Protocol Connectivity
          </h4>
          <div className='grid grid-cols-2 gap-3'>
            {/* IPv4 Status */}
            <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-3'>
              <div className='mb-1 flex items-center justify-between'>
                <span className='text-xs font-medium text-gray-400'>IPv4</span>
                <span
                  className={`text-xs font-semibold ${
                    protocolStatus.ipv4.available
                      ? 'text-green-400'
                      : protocolStatus.ipv4.tested
                        ? 'text-red-400'
                        : 'text-gray-500'
                  }`}
                >
                  {protocolStatus.ipv4.tested
                    ? protocolStatus.ipv4.available
                      ? '✓ Available'
                      : '✗ Unavailable'
                    : 'Not Tested'}
                </span>
              </div>
              {protocolStatus.ipv4.latency !== undefined && (
                <div className='text-xs text-gray-500'>
                  Latency: {protocolStatus.ipv4.latency}ms
                </div>
              )}
              {protocolStatus.ipv4.error && (
                <div className='mt-1 text-xs text-red-400'>
                  {protocolStatus.ipv4.error}
                </div>
              )}
            </div>

            {/* IPv6 Status */}
            <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-3'>
              <div className='mb-1 flex items-center justify-between'>
                <span className='text-xs font-medium text-gray-400'>IPv6</span>
                <span
                  className={`text-xs font-semibold ${
                    protocolStatus.ipv6.available
                      ? 'text-green-400'
                      : protocolStatus.ipv6.tested
                        ? 'text-red-400'
                        : 'text-gray-500'
                  }`}
                >
                  {protocolStatus.ipv6.tested
                    ? protocolStatus.ipv6.available
                      ? '✓ Available'
                      : '✗ Unavailable'
                    : 'Not Tested'}
                </span>
              </div>
              {protocolStatus.ipv6.latency !== undefined && (
                <div className='text-xs text-gray-500'>
                  Latency: {protocolStatus.ipv6.latency}ms
                </div>
              )}
              {protocolStatus.ipv6.error && (
                <div className='mt-1 text-xs text-red-400'>
                  {protocolStatus.ipv6.error}
                </div>
              )}
            </div>
          </div>
          {protocolStatus.lastTested > 0 && (
            <div className='mt-2 text-xs text-gray-500'>
              Last tested: {formatAbsoluteTime(protocolStatus.lastTested)}
            </div>
          )}
        </div>

        {/* Suspected Issues */}
        {suspectedIssues.length > 0 && (
          <div>
            <h4 className='mb-2 text-sm font-medium text-gray-300'>
              Suspected Issues
            </h4>
            <div className='space-y-1'>
              {suspectedIssues.map((issue: string, index: number) => (
                <div
                  key={index}
                  className='rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300'
                >
                  {issue}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last Investigation */}
        {lastInvestigation && (
          <div>
            <h4 className='mb-2 text-sm font-medium text-gray-300'>
              Last Investigation
            </h4>
            <div className='space-y-2 rounded-lg border border-gray-700 bg-gray-800/50 p-3 text-xs'>
              <div>
                <span className='text-gray-400'>Time:</span>{' '}
                <span className='text-gray-300'>
                  {formatAbsoluteTime(lastInvestigation.timestamp)}
                </span>
              </div>
              <div>
                <span className='text-gray-400'>Failed Request:</span>{' '}
                <span className='font-mono text-gray-300'>
                  {lastInvestigation.trigger.method}{' '}
                  {lastInvestigation.trigger.url}
                </span>
              </div>
              <div>
                <span className='text-gray-400'>Error:</span>{' '}
                <span className='text-red-400'>
                  {lastInvestigation.trigger.error}
                </span>
              </div>

              {lastInvestigation.recommendations.length > 0 && (
                <div className='mt-2 border-t border-gray-700 pt-2'>
                  <div className='mb-1 text-gray-400'>Recommendations:</div>
                  <ul className='ml-3 list-disc space-y-0.5 text-gray-300'>
                    {lastInvestigation.recommendations.map(
                      (rec: string, index: number) => (
                        <li key={index}>{rec}</li>
                      )
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recent Failures */}
        {recentFailures.length > 0 && (
          <div>
            <h4 className='mb-2 text-sm font-medium text-gray-300'>
              Recent Failed Requests ({recentFailures.length})
            </h4>
            <div className='space-y-1'>
              {recentFailures
                .slice(0, 5)
                .map((failure: FailedRequestInfo, index: number) => (
                  <div
                    key={index}
                    className='rounded-lg border border-gray-700 bg-gray-800/30 px-3 py-2 text-xs'
                  >
                    <div className='flex items-start justify-between'>
                      <span className='font-mono text-gray-400'>
                        {failure.method} {failure.url.split('?')[0]}
                      </span>
                      <span className='text-gray-500'>
                        {formatAbsoluteTime(failure.timestamp)}
                      </span>
                    </div>
                    <div className='mt-1 text-red-400'>{failure.error}</div>
                  </div>
                ))}
              {recentFailures.length > 5 && (
                <div className='text-center text-xs text-gray-500'>
                  +{recentFailures.length - 5} more failures
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  )
}
