'use client'

import { CollapsibleSection } from '../diagnostic-components'
import { LogEntry } from '@/shared/types/health'
import { formatAbsoluteTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface SystemLogsSectionProps {
  internalLogs?: LogEntry[]
}

export function SystemLogsSection({
  internalLogs
}: SystemLogsSectionProps): JSX.Element | null {
  if (!internalLogs || internalLogs.length === 0) {
    return null
  }

  return (
    <CollapsibleSection
      title='System Logs'
      defaultExpanded={false}
      severity='info'
    >
      <div className='max-h-96 space-y-1 overflow-y-auto rounded bg-black/50 p-2 font-mono text-xs'>
        {internalLogs.map((log, index) => (
          <div
            key={`${log.timestamp}-${index}`}
            className='border-white/5 border-b pb-1 last:border-0 last:pb-0'
          >
            <div className='flex gap-2'>
              <span className='whitespace-nowrap text-gray-500'>
                {formatAbsoluteTime(log.timestamp)}
              </span>
              <span
                className={cn(
                  'w-12 flex-shrink-0 font-bold',
                  log.level === 'ERROR'
                    ? 'text-red-400'
                    : log.level === 'WARN'
                      ? 'text-yellow-400'
                      : log.level === 'INFO'
                        ? 'text-blue-400'
                        : 'text-gray-400'
                )}
              >
                {log.level}
              </span>
              <span className='break-all text-gray-300'>{log.message}</span>
            </div>
            {log.details != null && (
              <pre className='mt-1 overflow-x-auto whitespace-pre-wrap pl-24 text-gray-500'>
                {JSON.stringify(log.details, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  )
}
