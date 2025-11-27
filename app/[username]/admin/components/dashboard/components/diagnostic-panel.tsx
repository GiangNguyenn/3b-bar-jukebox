'use client'

import { useState, useMemo, useCallback } from 'react'
import type { HealthStatus } from '@/shared/types/health'
import {
  useSpotifyPlayerStore,
  type PlayerStatus
} from '@/hooks/useSpotifyPlayer'
import { cn, formatDuration, formatRelativeTime } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import {
  hasErrorStatus,
  hasWarningStatus,
  getOverallSeverity,
  getSeverityStyles,
  formatEventType,
  formatDiagnosticsForClipboard
} from './diagnostic-utils'
import {
  ErrorBox,
  StatusField,
  ChevronIcon,
  CopyIcon
} from './diagnostic-components'

interface DiagnosticPanelProps {
  healthStatus: HealthStatus
  isReady: boolean
  playerStatus?: PlayerStatus
  className?: string
}

interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultExpanded?: boolean
  severity?: 'info' | 'warning' | 'error'
  className?: string
  headerActions?: React.ReactNode
}

const severityColors = {
  error: 'border-red-500',
  warning: 'border-yellow-500',
  info: 'border-gray-800'
} as const

function CollapsibleSection({
  title,
  children,
  defaultExpanded = false,
  severity = 'info',
  className,
  headerActions
}: CollapsibleSectionProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const severityColor = severityColors[severity]

  return (
    <div
      className={cn(
        'rounded-lg border bg-gray-900/50',
        severityColor,
        className
      )}
    >
      <div className='flex items-center gap-2 px-4 py-3'>
        <button
          type='button'
          onClick={() => setIsExpanded(!isExpanded)}
          className='flex flex-1 items-center justify-between text-left transition-colors hover:bg-gray-800/50'
        >
          <span className='text-white text-sm font-semibold'>{title}</span>
          <ChevronIcon expanded={isExpanded} />
        </button>
        {headerActions && (
          <div onClick={(e) => e.stopPropagation()}>{headerActions}</div>
        )}
      </div>
      {isExpanded && <div className='space-y-2 px-4 pb-4'>{children}</div>}
    </div>
  )
}

export function DiagnosticPanel({
  healthStatus,
  isReady,
  playerStatus,
  className
}: DiagnosticPanelProps): JSX.Element {
  const { status: currentPlayerStatus } = useSpotifyPlayerStore()

  const hasErrors = useMemo(() => hasErrorStatus(healthStatus), [healthStatus])

  const hasWarnings = useMemo(
    () => hasWarningStatus(healthStatus),
    [healthStatus]
  )

  const overallSeverity = useMemo(
    () => getOverallSeverity(hasErrors, hasWarnings),
    [hasErrors, hasWarnings]
  )

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
              Date.now() - healthStatus.playbackDetails.lastProgressUpdate
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

  const handleCopyDiagnostics = useCallback(async (): Promise<void> => {
    try {
      const diagnosticsText = formatDiagnosticsForClipboard(
        healthStatus,
        isReady,
        playerStatus,
        currentPlayerStatus
      )
      await navigator.clipboard.writeText(diagnosticsText)
      showToast('Diagnostics copied to clipboard', 'success')
    } catch (error) {
      showToast('Failed to copy diagnostics', 'warning')
      console.error('Failed to copy diagnostics:', error)
    }
  }, [healthStatus, isReady, playerStatus, currentPlayerStatus])

  return (
    <div className={cn('space-y-4', className)}>
      <CollapsibleSection
        title='System Diagnostics'
        defaultExpanded={!hasErrors}
        severity={overallSeverity}
        headerActions={
          <button
            type='button'
            onClick={handleCopyDiagnostics}
            className='text-white flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm font-medium transition-colors hover:border-gray-600 hover:bg-gray-700'
            title='Copy all diagnostics to clipboard'
          >
            <CopyIcon className='h-4 w-4' />
            Copy Diagnostics
          </button>
        }
      >
        <div className='space-y-4'>
          {/* Critical Issues */}
          {hasErrors && (
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
          )}

          {/* System Status Overview */}
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
              <StatusField
                label='Playback Status'
                value={healthStatus.playback}
              />
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

          {/* Playback State */}
          {healthStatus.playbackDetails && (
            <CollapsibleSection
              title='Playback State'
              defaultExpanded={!hasErrors}
              severity={
                healthStatus.playbackDetails.isStalled
                  ? 'error'
                  : !healthStatus.playbackDetails.isPlaying
                    ? 'warning'
                    : 'info'
              }
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
                          {healthStatus.playbackDetails.isStalled &&
                            ' (Stalled)'}
                        </>
                      }
                    />
                  </div>
                </div>
              ) : (
                <p className='text-sm text-gray-400'>
                  No track currently playing
                </p>
              )}
            </CollapsibleSection>
          )}

          {/* Queue Information */}
          {healthStatus.queueState && (
            <CollapsibleSection
              title='Queue Information'
              defaultExpanded={!hasErrors}
              severity={
                healthStatus.queueState.isEmpty
                  ? 'warning'
                  : !healthStatus.queueState.hasNextTrack
                    ? 'warning'
                    : 'info'
              }
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
                    <p className='text-sm text-yellow-200'>
                      No next track in queue
                    </p>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Recent Events Timeline */}
          {healthStatus.recentEvents &&
            healthStatus.recentEvents.length > 0 && (
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
                          <p className='text-white mt-1 text-sm'>
                            {event.message}
                          </p>
                          {event.details &&
                            Object.keys(event.details).length > 0 && (
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
            )}

          {/* Technical Details */}
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
                        Last Success:{' '}
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
        </div>
      </CollapsibleSection>
    </div>
  )
}
