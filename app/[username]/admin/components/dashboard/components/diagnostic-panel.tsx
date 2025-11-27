'use client'

import { useMemo, useCallback } from 'react'
import type { HealthStatus } from '@/shared/types/health'
import {
  useSpotifyPlayerStore,
  type PlayerStatus
} from '@/hooks/useSpotifyPlayer'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import {
  hasErrorStatus,
  hasWarningStatus,
  getOverallSeverity,
  formatDiagnosticsForClipboard
} from './diagnostic-utils'
import { CollapsibleSection, CopyIcon } from './diagnostic-components'
import {
  CriticalIssuesSection,
  SystemStatusSection,
  PlaybackStateSection,
  QueueInformationSection,
  RecentEventsSection,
  TechnicalDetailsSection
} from './diagnostic-sections'

interface DiagnosticPanelProps {
  healthStatus: HealthStatus
  isReady: boolean
  playerStatus?: PlayerStatus
  className?: string
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
            onClick={() => {
              void handleCopyDiagnostics()
            }}
            className='text-white flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm font-medium transition-colors hover:border-gray-600 hover:bg-gray-700'
            title='Copy all diagnostics to clipboard'
          >
            <CopyIcon className='h-4 w-4' />
            Copy Diagnostics
          </button>
        }
      >
        <div className='space-y-4'>
          <CriticalIssuesSection
            healthStatus={healthStatus}
            hasErrors={hasErrors}
          />

          <SystemStatusSection
            healthStatus={healthStatus}
            playerStatus={playerStatus}
            isReady={isReady}
            hasErrors={hasErrors}
            overallSeverity={overallSeverity}
          />

          <PlaybackStateSection
            healthStatus={healthStatus}
            hasErrors={hasErrors}
          />

          <QueueInformationSection
            healthStatus={healthStatus}
            hasErrors={hasErrors}
          />

          <RecentEventsSection
            healthStatus={healthStatus}
            hasErrors={hasErrors}
          />

          <TechnicalDetailsSection
            healthStatus={healthStatus}
            currentPlayerStatus={currentPlayerStatus}
          />
        </div>
      </CollapsibleSection>
    </div>
  )
}
