'use client'

import { useMemo } from 'react'
import type { HealthStatus } from '@/shared/types/health'
import { formatRelativeTime } from '@/lib/utils'
import { CollapsibleSection } from '../diagnostic-components'
import { ErrorBox } from '../diagnostic-components'

interface CriticalIssuesSectionProps {
  healthStatus: HealthStatus
  hasErrors: boolean
}

export function CriticalIssuesSection({
  healthStatus,
  hasErrors
}: CriticalIssuesSectionProps): JSX.Element | null {
  const criticalIssues = useMemo(() => {
    const issues: Array<{
      type: string
      title: string
      message: string
      timestamp?: number
      children?: React.ReactNode
    }> = []

    if (healthStatus.lastError) {
      issues.push({
        type: 'error',
        title: 'Last Error',
        message: healthStatus.lastError,
        timestamp: healthStatus.lastErrorTimestamp
      })
    }

    if (healthStatus.device === 'error') {
      issues.push({
        type: 'device',
        title: 'Device Error',
        message: 'Device connection has failed'
      })
    }

    if (healthStatus.playback === 'error') {
      issues.push({
        type: 'playback-error',
        title: 'Playback Error',
        message: 'Playback has encountered an error'
      })
    }

    if (healthStatus.playback === 'stalled') {
      issues.push({
        type: 'playback-stalled',
        title: 'Playback Stalled',
        message: 'Playback has stopped making progress',
        children: healthStatus.playbackDetails?.lastProgressUpdate ? (
          <p className='mt-1 text-xs text-red-300/70'>
            Last update:{' '}
            {formatRelativeTime(
              healthStatus.playbackDetails.lastProgressUpdate
            )}
          </p>
        ) : undefined
      })
    }

    if ((healthStatus.failureMetrics?.consecutiveFailures ?? 0) > 0) {
      issues.push({
        type: 'failures',
        title: `Consecutive Failures: ${healthStatus.failureMetrics?.consecutiveFailures}`,
        message: '',
        timestamp: healthStatus.failureMetrics?.lastFailureTimestamp
      })
    }

    return issues
  }, [healthStatus])

  if (!hasErrors || criticalIssues.length === 0) {
    return null
  }

  return (
    <CollapsibleSection
      title='Critical Issues'
      defaultExpanded={hasErrors}
      severity='error'
    >
      {criticalIssues.map((issue) => (
        <ErrorBox
          key={issue.type}
          title={issue.title}
          message={issue.message}
          timestamp={issue.timestamp}
        >
          {issue.children}
        </ErrorBox>
      ))}
    </CollapsibleSection>
  )
}
