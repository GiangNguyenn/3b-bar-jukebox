'use client'

interface UptimeDisplayProps {
  uptime: number
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  const parts = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`)

  return parts.join(' ')
}

export function UptimeDisplay({ uptime }: UptimeDisplayProps): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <h3 className="mb-2 text-sm font-medium text-gray-400">Uptime</h3>
      <p className="text-2xl font-semibold text-gray-300">{formatTime(uptime)}</p>
    </div>
  )
} 