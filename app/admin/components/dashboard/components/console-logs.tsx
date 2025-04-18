'use client'

import { LogEntry } from '@/hooks/useConsoleLogs'

interface ConsoleLogsProps {
  logs: LogEntry[]
}

export function ConsoleLogs({ logs }: ConsoleLogsProps): JSX.Element {
  return (
    <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
      <h3 className='mb-2 text-sm font-medium text-gray-400'>Console Logs</h3>
      <div className='max-h-48 overflow-y-auto rounded-md bg-black p-2 font-mono text-sm'>
        {logs.length === 0 ? (
          <p className='text-gray-500'>No logs available</p>
        ) : (
          <div className='space-y-1'>
            {logs.slice(-20).map((log, index) => (

              <div key={index} className='text-gray-300'>
                <span className='text-gray-500'>[{log.timestamp}] </span>
                <span
                  className={`${
                    log.level === 'ERROR'
                      ? 'text-red-400'
                      : log.level === 'WARN'
                        ? 'text-yellow-400'
                        : log.level === 'INFO'
                          ? 'text-blue-400'
                          : 'text-gray-300'
                  }`}
                >
                  {log.context ? `[${log.context}] ` : ''}
                  {log.message}
                </span>
                {log.error && (
                  <div className='mt-1 text-red-400'>{log.error.message}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
