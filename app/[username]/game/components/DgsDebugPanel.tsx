'use client'

import { useState, useCallback } from 'react'
import type {
  DgsDebugInfo,
  ExplorationPhase,
  PlayerGravityMap,
  PlayerId,
  ScoringComponents,
  DgsOptionTrack
} from '@/services/game/dgsTypes'
import { showToast } from '@/lib/toast'

interface DgsDebugPanelProps {
  playerGravities: PlayerGravityMap
  roundTurn: number
  turnCounter: number
  explorationPhase: ExplorationPhase
  ogDrift: number
  candidatePoolSize: number
  hardConvergenceActive: boolean
  vicinity: { triggered: boolean; playerId?: PlayerId }
  players?: Array<{ id: PlayerId; targetArtist: { name: string } | null }>
  activePlayerId?: PlayerId
  options: DgsOptionTrack[]
  debugInfo?: DgsDebugInfo
}

type TabId = 'overview' | 'pipeline' | 'performance' | 'logs'

export function DgsDebugPanel({
  playerGravities,
  roundTurn,
  turnCounter,
  explorationPhase,
  ogDrift,
  candidatePoolSize,
  hardConvergenceActive,
  vicinity,
  players,
  activePlayerId,
  options,
  debugInfo
}: DgsDebugPanelProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  const handleCopyToClipboard = useCallback(async () => {
    try {
      const fullDump = {
        gameState: {
          roundTurn,
          turnCounter,
          explorationPhase,
          playerGravities,
          players,
          activePlayerId,
          options
        },
        debugInfo
      }
      await navigator.clipboard.writeText(JSON.stringify(fullDump, null, 2))
      showToast('Full debug JSON copied to clipboard', 'success')
    } catch (error) {
      console.error('Failed to copy debug data:', error)
      showToast('Failed to copy debug data', 'warning')
    }
  }, [
    roundTurn,
    turnCounter,
    explorationPhase,
    playerGravities,
    players,
    activePlayerId,
    options,
    debugInfo
  ])

  if (!isExpanded) {
    return (
      <div className='fixed bottom-4 right-4 z-50'>
        <button
          onClick={() => setIsExpanded(true)}
          className='flex items-center justify-center rounded-full bg-gray-800 p-3 text-white shadow-lg transition-transform hover:scale-110 hover:bg-gray-700'
          title='Open DGS Debug Panel'
        >
          <span className='font-mono text-xs font-bold'>DGS</span>
        </button>
      </div>
    )
  }

  return (
    <div className='fixed bottom-4 right-4 z-50 flex h-[600px] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl'>
      {/* Header */}
      <div className='flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-2'>
        <div className='flex items-center gap-2'>
          <span className='font-bold text-gray-200'>DGS Debug</span>
          {debugInfo?.executionTimeMs && (
            <span
              className={`text-xs font-mono ${debugInfo.executionTimeMs < 2000
                ? 'text-green-400'
                : debugInfo.executionTimeMs < 5000
                  ? 'text-yellow-400'
                  : 'text-red-400'
                }`}
            >
              ({debugInfo.executionTimeMs}ms)
            </span>
          )}
        </div>
        <div className='flex items-center gap-2'>
          <button
            onClick={handleCopyToClipboard}
            className='rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white'
            title='Copy State to Clipboard'
          >
            📋
          </button>
          <button
            onClick={() => setIsExpanded(false)}
            className='rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white'
            title='Close Panel'
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className='flex border-b border-gray-700 bg-gray-800/50 text-xs'>
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'pipeline', label: 'Pipeline' },
          { id: 'performance', label: 'Performance' },
          { id: 'logs', label: 'Logs' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabId)}
            className={`flex-1 py-2 font-medium transition-colors ${activeTab === tab.id
              ? 'border-b-2 border-blue-500 bg-gray-800 text-blue-400'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className='flex-1 overflow-y-auto p-4 text-xs scrollbar-thin scrollbar-track-gray-900 scrollbar-thumb-gray-700'>
        {activeTab === 'overview' && (
          <OverviewTab
            roundTurn={roundTurn}
            turnCounter={turnCounter}
            activePlayerId={activePlayerId}
            playerGravities={playerGravities}
            explorationPhase={explorationPhase}
            ogDrift={ogDrift}
            candidatePoolSize={candidatePoolSize}
            vicinity={vicinity}
            hardConvergenceActive={hardConvergenceActive}
            players={players}
            debugInfo={debugInfo}
          />
        )}
        {activeTab === 'pipeline' && (
          <PipelineTab
            debugInfo={debugInfo}
            options={options}
            activePlayerId={activePlayerId}
          />
        )}
        {activeTab === 'performance' && (
          <PerformanceTab debugInfo={debugInfo} />
        )}
        {activeTab === 'logs' && <LogsTab debugInfo={debugInfo} />}
      </div>
    </div>
  )
}

function OverviewTab({
  roundTurn,
  turnCounter,
  activePlayerId,
  playerGravities,
  explorationPhase,
  ogDrift,
  candidatePoolSize,
  vicinity,
  hardConvergenceActive,
  players,
  debugInfo
}: any) {
  const p1Gravity = playerGravities?.player1 ?? 0
  const p2Gravity = playerGravities?.player2 ?? 0

  return (
    <div className='space-y-4'>
      {/* Game State */}
      <Section title='Game State'>
        <div className='grid grid-cols-2 gap-2 text-gray-400'>
          <div className='flex justify-between rounded bg-gray-800 p-2'>
            <span>Round:</span>
            <span className='font-mono text-gray-200'>{roundTurn}/10</span>
          </div>
          <div className='flex justify-between rounded bg-gray-800 p-2'>
            <span>Turn:</span>
            <span className='font-mono text-gray-200'>{turnCounter}</span>
          </div>
          <div className='col-span-2 flex justify-between rounded bg-gray-800 p-2'>
            <span>Active Player:</span>
            <span
              className={`font-bold ${activePlayerId === 'player1' ? 'text-blue-400' : 'text-green-400'
                }`}
            >
              {activePlayerId === 'player1' ? 'Player 1' : 'Player 2'}
            </span>
          </div>
        </div>
      </Section>

      {/* Gravities */}
      <Section title='Player Gravities'>
        <div className='space-y-2'>
          <GravityBar
            label='Player 1'
            value={p1Gravity}
            color='bg-blue-500'
            targetName={players?.find((p: any) => p.id === 'player1')?.targetArtist?.name}
          />
          <GravityBar
            label='Player 2'
            value={p2Gravity}
            color='bg-green-500'
            targetName={players?.find((p: any) => p.id === 'player2')?.targetArtist?.name}
          />
        </div>
      </Section>

      {/* Exploration & System */}
      <Section title='Exploration & System'>
        <div className='space-y-1 text-gray-400'>
          <div className='flex justify-between'>
            <span>Phase Level:</span>
            <span className='capitalize text-gray-200'>
              {explorationPhase?.level ?? 'N/A'}
            </span>
          </div>
          <div className='flex justify-between'>
            <span>OG Drift:</span>
            <span className='font-mono text-gray-200'>
              {ogDrift?.toFixed(3) ?? '0.000'}
            </span>
          </div>
          <div className='flex justify-between'>
            <span>Pool Size:</span>
            <span className='font-mono text-gray-200'>
              {candidatePoolSize}
            </span>
          </div>
          {hardConvergenceActive && (
            <div className='mt-2 rounded bg-red-900/30 p-2 text-center text-red-400 font-bold'>
              HARD CONVERGENCE ACTIVE
            </div>
          )}
          {vicinity?.triggered && (
            <div className='mt-1 rounded bg-yellow-900/30 p-2 text-center text-yellow-400 font-bold'>
              VICINITY TRIGGERED ({vicinity.playerId === 'player1' ? 'P1' : 'P2'})
            </div>
          )}
          {/* Target Resolution Status */}
          {debugInfo?.targetProfiles && (
            <div className='mt-2 border-t border-gray-700 pt-2'>
              <div className='mb-1 font-semibold text-gray-400'>Target Resolution</div>
              <div className='flex justify-between text-[10px]'>
                <span className={debugInfo.targetProfiles.player1?.resolved ? 'text-green-400' : 'text-red-400'}>
                  P1: {debugInfo.targetProfiles.player1?.resolved ? 'OK' : 'FAIL'}
                </span>
                <span className={debugInfo.targetProfiles.player2?.resolved ? 'text-green-400' : 'text-red-400'}>
                  P2: {debugInfo.targetProfiles.player2?.resolved ? 'OK' : 'FAIL'}
                </span>
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}

function PipelineTab({ debugInfo, options, activePlayerId }: any) {
  if (!debugInfo) return <div className='text-gray-500'>No debug info available</div>

  const selectedArtists = debugInfo.selectedArtists ?? []
  const hasSelectedArtists = selectedArtists.length > 0

  return (
    <div className='space-y-4'>
      {/* Stage 1: Pool */}
      <Section title='Stage 1: Artist Pool'>
        <div className='grid grid-cols-3 gap-2 text-center'>
          <PoolStat
            label='Related (Current)'
            count={debugInfo.candidatePool?.relatedToCurrent?.length ?? 0}
            color='text-blue-400'
          />
          <PoolStat
            label='Related (Target)'
            count={debugInfo.candidatePool?.relatedToTarget?.length ?? 0}
            color='text-purple-400'
          />
          <PoolStat
            label='Random'
            count={debugInfo.candidatePool?.randomArtists?.length ?? 0}
            color='text-yellow-400'
          />
        </div>
        <div className='mt-2 text-[10px] text-gray-500 text-center'>
          Total Unique: {debugInfo.candidatePool?.totalUnique ?? 0} artists
        </div>
      </Section>

      {/* Stage 2: Selection */}
      <Section title={`Stage 2: Artist Scoring (Total ${debugInfo.scoring?.totalCandidates ?? 0})`}>
        {hasSelectedArtists || (debugInfo.candidates && debugInfo.candidates.length > 0) ? (
          <div className='space-y-3'>
            <ArtistGroup
              category='CLOSER'
              artists={(debugInfo.candidates ?? selectedArtists).filter((a: any) =>
                (a.category?.toUpperCase() === 'CLOSER')
              )}
              color='text-green-400'
            />
            <ArtistGroup
              category='NEUTRAL'
              artists={(debugInfo.candidates ?? selectedArtists).filter((a: any) =>
                (a.category?.toUpperCase() === 'NEUTRAL')
              )}
              color='text-yellow-400'
            />
            <ArtistGroup
              category='FURTHER'
              artists={(debugInfo.candidates ?? selectedArtists).filter((a: any) =>
                (a.category?.toUpperCase() === 'FURTHER')
              )}
              color='text-red-400'
            />
          </div>
        ) : (
          <div className='text-gray-500 italic'>No scored candidates data</div>
        )}
      </Section>

      {/* Stage 3: Options */}
      <Section title='Stage 3: Final Options'>
        <div className='space-y-2'>
          {options.map((opt: DgsOptionTrack, i: number) => {
            const metrics = opt.metrics
            if (!metrics) return null
            return (
              <div key={i} className='rounded border border-gray-700 bg-gray-800 p-2'>
                <div className='flex justify-between items-center mb-1'>
                  <span className='font-semibold text-gray-300 truncate w-2/3'>{opt.track?.name}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${metrics.selectionCategory === 'closer' ? 'bg-green-900 text-green-300' :
                    metrics.selectionCategory === 'further' ? 'bg-red-900 text-red-300' :
                      'bg-gray-700 text-gray-300'
                    }`}>
                    {metrics.selectionCategory?.toUpperCase() ?? 'NEUTRAL'}
                  </span>
                </div>
                <div className='text-[10px] text-gray-400 flex justify-between'>
                  <span>{opt.artist?.name}</span>
                  <span>Sim: {metrics.simScore?.toFixed(3)}</span>
                </div>
                <div className='text-[10px] text-gray-500 flex justify-between mt-1'>
                  <span>Attraction: {activePlayerId === 'player1' ? metrics.aAttraction?.toFixed(3) : metrics.bAttraction?.toFixed(3)}</span>
                  <span>Delta: {metrics.delta?.toFixed(3)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

function PerformanceTab({ debugInfo }: any) {
  if (!debugInfo) return <div className='text-gray-500'>No debug info available</div>

  const timing = debugInfo.timingBreakdown
  const perf = debugInfo.performanceDiagnostics
  const caching = debugInfo.caching

  return (
    <div className='space-y-4'>
      {/* Timing */}
      <Section title='Execution Timing'>
        <div className='mb-2 flex justify-between font-bold text-gray-300'>
          <span>Total</span>
          <span>{timing?.totalMs ?? 0}ms</span>
        </div>
        {timing && (
          <div className='space-y-1'>
            <TimingBar label="Pool" val={timing.candidatePoolMs} total={timing.totalMs} color="bg-blue-600" />
            <TimingBar label="Targets" val={timing.targetResolutionMs} total={timing.totalMs} color="bg-purple-600" />
            <TimingBar label="Enrich" val={timing.enrichmentMs} total={timing.totalMs} color="bg-yellow-600" />
            <TimingBar label="Scoring" val={timing.scoringMs} total={timing.totalMs} color="bg-green-600" />
            <TimingBar label="Select" val={timing.selectionMs} total={timing.totalMs} color="bg-red-600" />
          </div>
        )}
      </Section>

      {/* Caching & API */}
      <Section title='Spotify API & Cache'>
        {caching && (
          <div className='grid grid-cols-2 gap-2 text-[10px]'>
            <MetricBox label="Cache Hit Rate" value={`${(caching.cacheHitRate * 100).toFixed(1)}%`}
              color={caching.cacheHitRate > 0.8 ? 'text-green-400' : 'text-yellow-400'} />
            <MetricBox label="Total API Calls" value={caching.totalApiCalls} color="text-orange-400" />

            <div className='col-span-2 mt-2 h-[1px] bg-gray-700' />
            <div className='col-span-2 font-semibold text-gray-400 mt-1'>Type Breakdown (Req / Cache / API)</div>

            <div className='col-span-2 grid grid-cols-4 gap-1 text-center text-gray-500'>
              <div>Type</div><div>Req</div><div>Cache</div><div>API</div>

              <div className='text-left text-gray-400'>Profiles</div>
              <div>{caching.artistProfilesRequested}</div>
              <div className='text-green-400'>{caching.artistProfilesCached}</div>
              <div className='text-orange-400'>{caching.artistProfilesFromSpotify}</div>

              <div className='text-left text-gray-400'>Related</div>
              <div>{caching.relatedArtistsRequested}</div>
              <div className='text-green-400'>{caching.relatedArtistsCached}</div>
              <div className='text-orange-400'>{caching.relatedArtistsFromSpotify}</div>

              <div className='text-left text-gray-400'>Tracks</div>
              <div>{caching.topTracksRequested}</div>
              <div className='text-green-400'>{caching.topTracksCached}</div>
              <div className='text-orange-400'>{caching.topTracksFromSpotify}</div>
            </div>
          </div>
        )}
      </Section>

      {/* API Trace */}
      {perf && perf.apiCalls && perf.apiCalls.length > 0 && (
        <Section title={`API Trace (${perf.apiCalls.length} calls)`}>
          <div className='max-h-40 overflow-y-auto space-y-1 text-[10px] scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 pr-1'>
            {perf.apiCalls.map((call: any, i: number) => (
              <div key={i} className='flex justify-between border-b border-gray-700/50 pb-0.5 last:border-0'>
                <span className='text-gray-400 truncate'>{call.operation}</span>
                <span className={`font-mono ${call.durationMs > 500 ? 'text-red-400 font-bold' :
                    call.durationMs > 200 ? 'text-yellow-400' : 'text-gray-500'
                  }`}>
                  {call.durationMs}ms
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* DB Performance */}
      {perf && (
        <Section title='Database Stats'>
          <div className='space-y-1 text-[10px]'>
            <div className='flex justify-between'>
              <span>Total DB Time:</span>
              <span className='font-mono text-blue-400'>{perf.totalDbTimeMs}ms</span>
            </div>
            <div className='flex justify-between'>
              <span>Queries:</span>
              <span className='font-mono text-gray-300'>{perf.dbQueries.length}</span>
            </div>
            {perf.slowestDbQuery && (
              <div className='mt-1 rounded bg-red-900/20 p-1'>
                <div className='text-red-400 font-semibold'>Slowest Query:</div>
                <div className='truncate text-gray-500'>{perf.slowestDbQuery.operation}</div>
                <div className='text-right font-mono text-red-300'>{perf.slowestDbQuery.durationMs}ms</div>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}

function LogsTab({ debugInfo }: any) {
  const logs = debugInfo?.pipelineLogs ?? []

  return (
    <div className='space-y-2 font-mono text-[10px]'>
      {logs.length === 0 && <div className='text-gray-500 italic'>No logs recorded</div>}
      {logs.map((log: any, i: number) => (
        <div key={i} className='border-b border-gray-800 pb-1 flex gap-2'>
          <span className='text-gray-600 shrink-0'>
            {new Date(log.timestamp).toISOString().split('T')[1].slice(0, 8)}
          </span>
          <span className={`uppercase font-bold shrink-0 w-12 ${log.level === 'error' ? 'text-red-500' :
            log.level === 'warn' ? 'text-yellow-500' : 'text-blue-500'
            }`}>
            [{log.level}]
          </span>
          <span className='text-gray-300 break-words'>
            {log.message}
            {log.details && (
              <div className='mt-0.5 text-gray-500'>
                {JSON.stringify(log.details)}
              </div>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

// --- Components ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='mb-4 rounded-lg bg-gray-800/30 p-3'>
      <h3 className='mb-2 font-semibold text-gray-300 uppercase tracking-wider text-[10px]'>{title}</h3>
      {children}
    </div>
  )
}

function GravityBar({ label, value, color, targetName }: any) {
  const safeValue = Math.max(0, Math.min(1, value))
  // Normalize logic: 0.15 to 0.7 roughly
  const normalize = (v: number) => (v - 0.15) / (0.7 - 0.15) * 100
  const width = Math.max(0, Math.min(100, normalize(safeValue)))

  return (
    <div>
      <div className='flex justify-between mb-1'>
        <span className='text-gray-400'>{label} <span className='text-gray-600 ml-1'>({targetName || 'None'})</span></span>
        <span className='font-mono text-gray-200'>{value.toFixed(3)}</span>
      </div>
      <div className='h-2 w-full rounded-full bg-gray-700 overflow-hidden'>
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function PoolStat({ label, count, color }: any) {
  return (
    <div className='rounded bg-gray-800 p-2'>
      <div className={`text-lg font-bold ${color}`}>{count}</div>
      <div className='text-[10px] text-gray-500'>{label}</div>
    </div>
  )
}

function ArtistGroup({ category, artists, color }: any) {
  if (artists.length === 0) return null
  return (
    <div>
      <div className={`mb-1 font-semibold ${color} text-[11px]`}>{category} ({artists.length})</div>
      <div className='space-y-1 pl-2 border-l border-gray-700 ml-1'>
        {artists.map((a: any, i: number) => (
          <div key={i} className='flex justify-between text-gray-400'>
            <span className='truncate w-2/3'>{a.artistName}</span>
            <span className='font-mono text-gray-500'>{(a.attractionScore ?? a.simScore)?.toFixed(3)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TimingBar({ label, val, total, color }: any) {
  const pct = total > 0 ? (val / total * 100) : 0
  return (
    <div className='flex items-center gap-2 text-[10px]'>
      <div className='w-16 shrink-0 text-gray-400 text-right'>{label}</div>
      <div className='flex-1 bg-gray-700 h-1.5 rounded-full overflow-hidden'>
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className='w-12 shrink-0 text-gray-300 font-mono text-right'>{val}ms</div>
    </div>
  )
}

function MetricBox({ label, value, color }: any) {
  return (
    <div className='rounded bg-gray-800 p-2 text-center'>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className='text-[9px] text-gray-500'>{label}</div>
    </div>
  )
}
