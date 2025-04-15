'use client'

interface ConsoleLogsProps {
  logs: string[]
}

export function ConsoleLogs({ logs }: ConsoleLogsProps): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <h3 className="mb-2 text-sm font-medium text-gray-400">Console Logs</h3>
      <div className="max-h-48 overflow-y-auto rounded-md bg-black p-2 font-mono text-sm">
        {logs.length === 0 ? (
          <p className="text-gray-500">No logs available</p>
        ) : (
          <div className="space-y-1">
            {logs.map((log, index) => (
              <div key={index} className="text-gray-300">
                {log}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
} 