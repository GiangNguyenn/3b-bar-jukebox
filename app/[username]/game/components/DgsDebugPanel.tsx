'use client'

import type {
  DgsDebugInfo,
  ExplorationPhase,
  PlayerGravityMap,
  PlayerId,
  ScoringComponents
} from '@/services/game/dgsTypes'
import { useState } from 'react'
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
  options: Array<{
    track?: {
      name?: string
      id?: string
    }
    artist?: {
      name?: string
      id?: string
    }
    metrics?: {
      simScore?: number
      scoreComponents?: ScoringComponents
      aAttraction?: number
      bAttraction?: number
      gravityScore?: number
      stabilizedScore?: number
      finalScore?: number
      popularityBand?: 'low' | 'mid' | 'high'
      forceReason?: 'vicinity' | 'hard_convergence'
      vicinityDistances?: Partial<Record<PlayerId, number>>
      currentSongAttraction?: number
      selectionCategory?: 'closer' | 'neutral' | 'further'
    }
  }>
  debugInfo?: DgsDebugInfo
}

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

  /* Safe accessors to prevent crashes */
  const p1Gravity = playerGravities?.player1 ?? 0
  const p2Gravity = playerGravities?.player2 ?? 0

  const formatScore = (score: number | undefined): string => {
    if (score === undefined) return 'N/A'
    return score.toFixed(3)
  }

  const formatDistance = (distance: number | undefined): string => {
    if (distance === undefined) return 'N/A'
    return distance.toFixed(3)
  }

  const getDistanceColor = (distance: number | undefined): string => {
    if (distance === undefined) return 'text-gray-500'
    if (distance < 0.2) return 'text-green-400' // Very close
    if (distance < 0.4) return 'text-yellow-400' // Close
    if (distance < 0.6) return 'text-orange-400' // Medium
    return 'text-red-400' // Far
  }

  const formatDebugDataForClipboard = (): string => {
    const lines: string[] = []
    lines.push('=== DGS Debug Panel ===')
    lines.push('')
    lines.push('Round & Turn')
    lines.push(`Round: ${roundTurn}/10 (Convergence Limit)`)
    lines.push(`Turn: ${turnCounter}`)
    lines.push(
      `Active: ${activePlayerId === 'player1' ? 'Player 1' : 'Player 2'}`
    )
    lines.push('')
    lines.push('Player Gravities')
    lines.push(`Player 1: ${p1Gravity.toFixed(3)}`)
    lines.push(`Player 2: ${p2Gravity.toFixed(3)}`)
    lines.push('')
    lines.push('Exploration Phase')
    lines.push(`Level: ${explorationPhase.level}`)
    lines.push(`OG Drift: ${ogDrift.toFixed(3)}`)
    lines.push(
      `Rounds: ${explorationPhase.rounds[0]}-${explorationPhase.rounds[1]}`
    )
    lines.push('')
    lines.push('System Status')
    lines.push(`Candidate Pool: ${candidatePoolSize}`)
    lines.push(
      `Hard Convergence: ${hardConvergenceActive ? 'Active' : 'Inactive'}`
    )
    lines.push(
      `Vicinity Trigger: ${vicinity.triggered ? `Active (${vicinity.playerId ?? 'unknown'})` : 'Inactive'}`
    )
    lines.push('')
    lines.push('Target Artists')
    lines.push(
      `Player 1: ${players?.find((p) => p.id === 'player1')?.targetArtist?.name ?? 'None'}`
    )
    lines.push(
      `Player 2: ${players?.find((p) => p.id === 'player2')?.targetArtist?.name ?? 'None'}`
    )
    lines.push('')
    lines.push(`Track Metrics (${options.length})`)

    // Calculate baseline and category for each option
    const baseline = options[0]?.metrics?.currentSongAttraction

    options.forEach((option, index) => {
      const metrics = option.metrics
      if (!metrics) return

      // Use server-provided category if available, otherwise fallback (though server should always provide it now)
      let category = metrics.selectionCategory
        ? metrics.selectionCategory.toUpperCase()
        : 'NEUTRAL'

      // If server didn't provide it, use local approximation (legacy fallback)
      const currentPlayerAttraction =
        activePlayerId === 'player1' ? metrics.aAttraction : metrics.bAttraction

      if (
        !metrics.selectionCategory &&
        baseline !== undefined &&
        currentPlayerAttraction !== undefined
      ) {
        const NEUTRAL_TOLERANCE = 0.02
        const diff = currentPlayerAttraction - baseline
        if (diff > NEUTRAL_TOLERANCE) {
          category = 'CLOSER'
        } else if (diff < -NEUTRAL_TOLERANCE) {
          category = 'FURTHER'
        }
      }

      lines.push('')
      lines.push(
        `Option ${index + 1} [${category}]${metrics.forceReason ? ` [${metrics.forceReason}]` : ''}`
      )
      if (option.track?.name) {
        lines.push(`  Track: ${option.track.name}`)
      }
      if (option.artist?.name) {
        lines.push(`  Artist: ${option.artist.name}`)
      }
      lines.push(`  Sim Score: ${formatScore(metrics.simScore)}`)
      lines.push(`  Final Score: ${formatScore(metrics.finalScore)}`)

      // Only show attraction details if they are relevant (non-zero or specifically debugging attraction)
      // Standardizing on showing what contributes to the score
      lines.push(`  Gravity Score: ${formatScore(metrics.gravityScore)}`)

      if (metrics.scoreComponents) {
        // Add breakdown if available
        const comps = metrics.scoreComponents
        lines.push('  Score Components:')
        lines.push(`    Genre Match: ${comps.genre.score.toFixed(3)}`)
        lines.push(`    Relationship: ${comps.relationship.toFixed(3)}`)
        lines.push(`    Track Pop: ${comps.trackPop.toFixed(3)}`)
        lines.push(`    Artist Pop: ${comps.artistPop.toFixed(3)}`)
        lines.push(`    Era Match: ${comps.era.toFixed(3)}`)
        lines.push(`    Follower Ratio: ${comps.followers.toFixed(3)}`)
      }

      lines.push(`  Metrics:`)
      lines.push(`    A Attraction: ${formatScore(metrics.aAttraction)}`)
      lines.push(`    B Attraction: ${formatScore(metrics.bAttraction)}`)
      if (baseline !== undefined && currentPlayerAttraction !== undefined) {
        lines.push(
          `    Current Player Attraction: ${formatScore(currentPlayerAttraction)}`
        )
        lines.push(`    Baseline: ${formatScore(baseline)}`)
        lines.push(
          `    Difference: ${(currentPlayerAttraction - baseline).toFixed(3)}`
        )
      }

      lines.push(`  Popularity: ${metrics.popularityBand ?? 'N/A'}`)
      lines.push(
        `  Vicinity P1: ${formatDistance(metrics.vicinityDistances?.player1)}`
      )
      lines.push(
        `  Vicinity P2: ${formatDistance(metrics.vicinityDistances?.player2)}`
      )

      // Genre Details
      if (
        metrics.scoreComponents &&
        typeof metrics.scoreComponents.genre !== 'number'
      ) {
        lines.push(`  Genre Details:`)

        // Add raw genre lists
        if (metrics.scoreComponents.genre.targetGenres) {
          lines.push(
            `    Target Genres: [${metrics.scoreComponents.genre.targetGenres.join(', ')}]`
          )
        }
        if (metrics.scoreComponents.genre.candidateGenres) {
          lines.push(
            `    Candidate Genres: [${metrics.scoreComponents.genre.candidateGenres.join(', ')}]`
          )
        }

        if (metrics.scoreComponents.genre.details.length > 0) {
          metrics.scoreComponents.genre.details.slice(0, 5).forEach((d) => {
            // Limit to top 5
            const relation =
              d.matchType === 'cluster'
                ? '[Same Cluster]'
                : d.matchType === 'related'
                  ? '[Related Cluster]'
                  : d.matchType === 'exact'
                    ? '[Exact]'
                    : d.matchType === 'partial'
                      ? '[Partial]'
                      : '[Unrelated]'

            lines.push(
              `    - ${d.candidateGenre} -> ${d.bestMatchGenre} (${d.score.toFixed(2)}) ${relation}`
            )
          })
        } else {
          lines.push(`    (No matches found)`)
        }
      }
    })

    if (debugInfo) {
      lines.push('')
      lines.push('=== Debug Information ===')
      lines.push('')
      lines.push('Target Profiles')
      if (debugInfo.targetProfiles?.player1) {
        lines.push(
          `  Player 1: ${debugInfo.targetProfiles.player1.resolved ? 'Resolved' : 'NOT RESOLVED'}`
        )
      }
      if (debugInfo.targetProfiles?.player2) {
        lines.push(
          `  Player 2: ${debugInfo.targetProfiles.player2.resolved ? 'Resolved' : 'NOT RESOLVED'}`
        )
      }

      lines.push('')
      lines.push('Artist Profiles')
      if (debugInfo.artistProfiles) {
        lines.push(`  Requested: ${debugInfo.artistProfiles.requested}`)
        lines.push(`  Fetched: ${debugInfo.artistProfiles.fetched}`)
        lines.push(`  Missing: ${debugInfo.artistProfiles.missing}`)
      } else if (debugInfo.caching) {
        lines.push(`  Requested: ${debugInfo.caching.artistProfilesRequested}`)
        // Fallback to caching stats
      }

      // ... keep existing scoring stats ...
      lines.push('')
      lines.push('Scoring')
      lines.push(`  Candidates: ${debugInfo.scoring?.totalCandidates ?? 0}`)
      lines.push(`  Fallbacks: ${debugInfo.scoring?.fallbackFetches ?? 0}`)

      lines.push('  Zero Attraction Reasons:')
      if (debugInfo.scoring?.zeroAttractionReasons) {
        lines.push(
          `    Missing Artist Profile: ${debugInfo.scoring.zeroAttractionReasons.missingArtistProfile}`
        )
        lines.push(
          `    Null Target Profile: ${debugInfo.scoring.zeroAttractionReasons.nullTargetProfile}`
        )
        lines.push(
          `    Zero Similarity: ${debugInfo.scoring.zeroAttractionReasons.zeroSimilarity}`
        )
      } else {
        lines.push('    Data unavailable')
      }
      lines.push('')

      if (debugInfo.caching) {
        lines.push('Spotify API & Cache Performance')
        lines.push(
          `  Overall Cache Hit Rate: ${(debugInfo.caching.cacheHitRate * 100).toFixed(1)}%`
        )
        lines.push(`  Total Cache Hits: ${debugInfo.caching.totalCacheHits}`)
        lines.push(`  Total API Calls: ${debugInfo.caching.totalApiCalls}`)
        lines.push('')
        lines.push('  Top Tracks:')
        lines.push(`    Requested: ${debugInfo.caching.topTracksRequested}`)
        lines.push(`    Cached: ${debugInfo.caching.topTracksCached}`)
        lines.push(`    From API: ${debugInfo.caching.topTracksFromSpotify}`)
        lines.push('  Track Details:')
        lines.push(`    Requested: ${debugInfo.caching.trackDetailsRequested}`)
        lines.push(`    Cached: ${debugInfo.caching.trackDetailsCached}`)
        lines.push(`    From API: ${debugInfo.caching.trackDetailsFromSpotify}`)
        lines.push('  Artist Profiles:')
        lines.push(
          `    Requested: ${debugInfo.caching.artistProfilesRequested}`
        )
        lines.push(`    Cached: ${debugInfo.caching.artistProfilesCached}`)
        lines.push(
          `    From API: ${debugInfo.caching.artistProfilesFromSpotify}`
        )
        lines.push('  Related Artists:')
        lines.push(
          `    Requested: ${debugInfo.caching.relatedArtistsRequested}`
        )
        lines.push(`    Cached: ${debugInfo.caching.relatedArtistsCached}`)
        lines.push(
          `    From API: ${debugInfo.caching.relatedArtistsFromSpotify}`
        )
        lines.push('  Artist Searches:')
        lines.push(
          `    Requested: ${debugInfo.caching.artistSearchesRequested}`
        )
        lines.push(`    Cached: ${debugInfo.caching.artistSearchesCached}`)
        lines.push(
          `    From API: ${debugInfo.caching.artistSearchesFromSpotify}`
        )
        lines.push('')
      }

      // Target Profiles
      if (debugInfo.targetProfiles) {
        lines.push('Target Profiles')
        lines.push('  Player 1:')
        lines.push(`    Resolved: ${debugInfo.targetProfiles.player1.resolved ? 'YES' : 'NO'}`)
        if (debugInfo.targetProfiles.player1.resolved) {
          lines.push(`    Artist: ${debugInfo.targetProfiles.player1.artistName}`)
          lines.push(`    ID: ${debugInfo.targetProfiles.player1.spotifyId}`)
          lines.push(`    Genres: ${debugInfo.targetProfiles.player1.genresCount}`)
        }
        lines.push('  Player 2:')
        lines.push(`    Resolved: ${debugInfo.targetProfiles.player2.resolved ? 'YES' : 'NO'}`)
        if (debugInfo.targetProfiles.player2.resolved) {
          lines.push(`    Artist: ${debugInfo.targetProfiles.player2.artistName}`)
          lines.push(`    ID: ${debugInfo.targetProfiles.player2.spotifyId}`)
          lines.push(`    Genres: ${debugInfo.targetProfiles.player2.genresCount}`)
        }
        lines.push('')
      }

      // Candidate Pool Analysis (Consolidated)
      if (debugInfo.candidatePool || (debugInfo.candidates && debugInfo.candidates.length > 0)) {
        lines.push('Candidate Pool Analysis')

        // 1. Seed Artists
        if (debugInfo.candidatePool?.seedArtists?.length) {
          debugInfo.candidatePool.seedArtists.forEach((artist) => {
            lines.push(`  From Seed: ${artist.name} (${artist.id})`)
            const candidates =
              debugInfo.candidates?.filter(
                (c) =>
                  c.source === 'related_top_tracks' ||
                  c.source === 'recommendations'
              ) ?? []

            if (candidates.length > 0) {
              candidates.slice(0, 10).forEach((c) => {
                lines.push(
                  `    - ${c.artistName} - ${c.trackName} [${c.filtered ? 'Filtered' : c.simScore.toFixed(3)}]`
                )
              })
              if (candidates.length > 10)
                lines.push(`    ... ${candidates.length - 10} more`)
            } else {
              lines.push('    (No candidates selected)')
            }
          })
        }

        // 2. Target Artists
        if (debugInfo.candidatePool?.targetArtists?.length) {
          debugInfo.candidatePool.targetArtists.forEach((artist) => {
            lines.push(`  From Target: ${artist.name} (${artist.id})`)
            const candidates =
              debugInfo.candidates?.filter(
                (c) => c.source?.includes('target') || c.isTargetArtist
              ) ?? []

            if (candidates.length > 0) {
              candidates.forEach((c) => {
                lines.push(
                  `    - ${c.artistName} - ${c.trackName} [${c.filtered ? 'Filtered' : c.simScore.toFixed(3)}]`
                )
              })
            } else {
              lines.push('    (No candidates injected)')
            }
          })
        }

        // 3. Fallback / Raw List
        if (
          !debugInfo.candidatePool?.seedArtists?.length &&
          !debugInfo.candidatePool?.targetArtists?.length &&
          debugInfo.candidates?.length
        ) {
          lines.push('  All Candidates (Fallback View)')
          debugInfo.candidates.slice(0, 50).forEach((c, idx) => {
            lines.push(
              `    ${idx + 1}. ${c.artistName} - ${c.trackName} [${c.source}] [${c.filtered ? 'FILTERED' : 'ALLOWED'}]`
            )
          })
        }

        lines.push('')
      }
    } // Genre Statistics
    if (debugInfo?.genreStatistics) {
      lines.push('')
      lines.push('Genre Statistics')
      lines.push(
        `  Genre Coverage: ${debugInfo.genreStatistics.percentageCoverage.toFixed(1)}% (${debugInfo.genreStatistics.tracksWithGenres}/${debugInfo.genreStatistics.totalTracks})`
      )
      lines.push(
        `  Missing Genres: ${debugInfo.genreStatistics.tracksWithNullGenres}`
      )
    }

    // Timing Breakdown
    if (debugInfo?.timingBreakdown) {
      lines.push('')
      lines.push('Timing Breakdown')
      const total = debugInfo.timingBreakdown.totalMs
      lines.push(`  Total: ${total}ms`)
      lines.push(
        `  Candidate Pool: ${debugInfo.timingBreakdown.candidatePoolMs}ms (${((debugInfo.timingBreakdown.candidatePoolMs / total) * 100).toFixed(1)}%)`
      )
      lines.push(
        `  Target Resolution: ${debugInfo.timingBreakdown.targetResolutionMs}ms (${((debugInfo.timingBreakdown.targetResolutionMs / total) * 100).toFixed(1)}%)`
      )
      lines.push(
        `  Enrichment: ${debugInfo.timingBreakdown.enrichmentMs}ms (${((debugInfo.timingBreakdown.enrichmentMs / total) * 100).toFixed(1)}%)`
      )
      lines.push(
        `  Scoring: ${debugInfo.timingBreakdown.scoringMs}ms (${((debugInfo.timingBreakdown.scoringMs / total) * 100).toFixed(1)}%)`
      )
      lines.push(
        `  Selection: ${debugInfo.timingBreakdown.selectionMs}ms (${((debugInfo.timingBreakdown.selectionMs / total) * 100).toFixed(1)}%)`
      )
    }

    return lines.join('\n')
  }

  const handleCopyToClipboard = async (): Promise<void> => {
    try {
      const debugText = formatDebugDataForClipboard()
      await navigator.clipboard.writeText(debugText)
      showToast('Debug data copied to clipboard', 'success')
    } catch (error) {
      showToast('Failed to copy debug data', 'warning')
      console.error('Failed to copy debug data:', error)
    }
  }

  return (
    <div className='fixed bottom-4 right-4 z-50 hidden max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl md:block md:max-w-sm lg:max-w-md'>
      <div className='flex items-center bg-gray-800'>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className='hover:bg-gray-750 flex flex-1 items-center justify-between px-4 py-2 text-left text-xs font-semibold text-gray-300'
        >
          <span className='uppercase tracking-wide'>DGS Debug Panel</span>
          <span className='text-gray-500'>{isExpanded ? '−' : '+'}</span>
        </button>
        <button
          onClick={() => {
            void handleCopyToClipboard()
          }}
          className='hover:bg-gray-750 px-3 py-2 text-xs text-gray-400 transition-colors hover:text-gray-200'
          title='Copy debug data to clipboard'
        >
          📋
        </button>
      </div>

      {isExpanded && (
        <div className='max-h-[calc(80vh-40px)] overflow-y-auto p-4 text-xs'>
          {/* Round & Turn Info */}
          <section className='mb-4 border-b border-gray-700 pb-3'>
            <h3 className='mb-2 font-semibold text-gray-300'>Round & Turn</h3>
            <div className='grid grid-cols-2 gap-2 text-gray-400'>
              <div>
                <span
                  className='text-gray-500'
                  title='Game continues after 10, but switches to hard convergence'
                >
                  Round:
                </span>{' '}
                {roundTurn}/10
              </div>
              <div>
                <span className='text-gray-500'>Turn:</span> {turnCounter}
              </div>
              <div className='col-span-2'>
                <span className='text-gray-500'>Active:</span>{' '}
                <span
                  className={`font-semibold ${activePlayerId === 'player1' ? 'text-blue-400' : 'text-green-400'}`}
                >
                  {activePlayerId === 'player1' ? 'Player 1' : 'Player 2'}
                </span>
              </div>
              {debugInfo?.executionTimeMs !== undefined && (
                <div className='col-span-2'>
                  <span className='text-gray-500'>Load Time:</span>{' '}
                  <span
                    className={`font-mono font-semibold ${debugInfo.executionTimeMs < 2000
                      ? 'text-green-400'
                      : debugInfo.executionTimeMs < 10000
                        ? 'text-yellow-400'
                        : 'text-red-400'
                      }`}
                  >
                    {debugInfo.executionTimeMs < 1000
                      ? `${debugInfo.executionTimeMs}ms`
                      : `${(debugInfo.executionTimeMs / 1000).toFixed(2)}s`}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Timing Breakdown */}
          {debugInfo?.timingBreakdown && (
            <section className='mb-4 border-b border-gray-700 pb-3'>
              <h3 className='mb-2 font-semibold text-gray-300'>
                Timing Breakdown
              </h3>
              <div className='space-y-2 text-xs'>
                {[
                  {
                    label: 'Candidate Pool',
                    value: debugInfo.timingBreakdown.candidatePoolMs,
                    key: 'candidatePool'
                  },
                  {
                    label: 'Target Resolution',
                    value: debugInfo.timingBreakdown.targetResolutionMs,
                    key: 'targetResolution'
                  },
                  {
                    label: 'Enrichment',
                    value: debugInfo.timingBreakdown.enrichmentMs,
                    key: 'enrichment'
                  },
                  {
                    label: 'Scoring',
                    value: debugInfo.timingBreakdown.scoringMs,
                    key: 'scoring'
                  },
                  {
                    label: 'Selection',
                    value: debugInfo.timingBreakdown.selectionMs,
                    key: 'selection'
                  }
                ].map(({ label, value, key }) => {
                  const percentage = debugInfo.timingBreakdown?.totalMs
                    ? (value / debugInfo.timingBreakdown.totalMs) * 100
                    : 0
                  const colorClass =
                    value < 2000
                      ? 'bg-green-500'
                      : value < 10000
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  const textColorClass =
                    value < 2000
                      ? 'text-green-400'
                      : value < 10000
                        ? 'text-yellow-400'
                        : 'text-red-400'

                  return (
                    <div key={key} className='space-y-1'>
                      <div className='flex items-center justify-between'>
                        <span className='text-gray-400'>{label}:</span>
                        <span
                          className={`font-mono font-semibold ${textColorClass}`}
                        >
                          {value < 1000
                            ? `${value}ms`
                            : `${(value / 1000).toFixed(2)}s`}
                          <span className='ml-1 text-gray-500'>
                            ({percentage.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                      <div className='h-1.5 w-full bg-gray-700'>
                        <div
                          className={`h-full ${colorClass}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Player Gravities */}
          <section className='mb-4 border-b border-gray-700 pb-3'>
            <h3 className='mb-2 font-semibold text-gray-300'>
              Player Gravities
            </h3>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-gray-400'>Player 1:</span>
                <div className='flex items-center gap-2'>
                  <div className='h-2 w-24 bg-gray-700'>
                    <div
                      className='h-full bg-blue-500'
                      style={{
                        width: `${((p1Gravity - 0.15) / (0.7 - 0.15)) * 100}%`
                      }}
                    />
                  </div>
                  <span className='font-mono text-gray-300'>
                    {p1Gravity.toFixed(3)}
                  </span>
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-gray-400'>Player 2:</span>
                <div className='flex items-center gap-2'>
                  <div className='h-2 w-24 bg-gray-700'>
                    <div
                      className='h-full bg-green-500'
                      style={{
                        width: `${((p2Gravity - 0.15) / (0.7 - 0.15)) * 100}%`
                      }}
                    />
                  </div>
                  <span className='font-mono text-gray-300'>
                    {p2Gravity.toFixed(3)}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Exploration Phase */}
          <section className='mb-4 border-b border-gray-700 pb-3'>
            <h3 className='mb-2 font-semibold text-gray-300'>
              Exploration Phase
            </h3>
            <div className='space-y-1 text-gray-400'>
              <div>
                <span className='text-gray-500'>Level:</span>{' '}
                <span className='capitalize text-gray-300'>
                  {explorationPhase.level}
                </span>
              </div>
              <div>
                <span className='text-gray-500'>OG Drift:</span>{' '}
                <span className='font-mono text-gray-300'>
                  {ogDrift.toFixed(3)}
                </span>
              </div>
              <div>
                <span className='text-gray-500'>Rounds:</span>{' '}
                <span className='text-gray-300'>
                  {explorationPhase.rounds[0]}-{explorationPhase.rounds[1]}
                </span>
              </div>
            </div>
          </section>

          {/* Caching Performance */}
          {debugInfo?.caching && (
            <section className='mb-4 border-b border-gray-700 pb-3'>
              <h3 className='mb-2 font-semibold text-gray-300'>
                Spotify API & Cache Performance
              </h3>
              <div className='space-y-3'>
                {/* Overall Summary */}
                <div className='rounded bg-gray-800 p-2'>
                  <div className='mb-1 flex items-center justify-between'>
                    <span className='text-gray-400'>
                      Overall Cache Hit Rate:
                    </span>
                    <span className='font-mono text-lg font-bold text-green-400'>
                      {(debugInfo.caching.cacheHitRate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className='h-2 w-full overflow-hidden rounded-full bg-gray-700'>
                    <div
                      className='h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500'
                      style={{
                        width: `${debugInfo.caching.cacheHitRate * 100}%`
                      }}
                    />
                  </div>
                  <div className='mt-2 grid grid-cols-2 gap-2 text-[10px]'>
                    <div>
                      <span className='text-gray-500'>Total Cache Hits:</span>
                      <span className='ml-1 font-mono text-green-400'>
                        {debugInfo.caching.totalCacheHits}
                      </span>
                    </div>
                    <div>
                      <span className='text-gray-500'>Total API Calls:</span>
                      <span className='ml-1 font-mono text-orange-400'>
                        {debugInfo.caching.totalApiCalls}
                      </span>
                    </div>
                  </div>

                  {/* Validation Indicator */}
                  {(() => {
                    const expectedApiCalls =
                      debugInfo.caching.topTracksApiCalls +
                      debugInfo.caching.trackDetailsApiCalls +
                      debugInfo.caching.relatedArtistsApiCalls +
                      debugInfo.caching.artistProfilesApiCalls +
                      debugInfo.caching.artistSearchesApiCalls

                    const expectedCacheHits =
                      debugInfo.caching.topTracksCached +
                      debugInfo.caching.trackDetailsCached +
                      debugInfo.caching.relatedArtistsCached +
                      debugInfo.caching.artistProfilesCached +
                      debugInfo.caching.artistSearchesCached

                    const apiCallsMatch =
                      expectedApiCalls === debugInfo.caching.totalApiCalls
                    const cacheHitsMatch =
                      expectedCacheHits === debugInfo.caching.totalCacheHits

                    if (!apiCallsMatch || !cacheHitsMatch) {
                      return (
                        <div className='mt-2 rounded border border-red-700 bg-red-900/20 p-1'>
                          <div className='font-mono text-[9px] text-red-400'>
                            ⚠ Validation Error:{' '}
                            {!apiCallsMatch &&
                              `API calls mismatch (${expectedApiCalls} ≠ ${debugInfo.caching.totalApiCalls})`}
                            {!apiCallsMatch && !cacheHitsMatch && ' | '}
                            {!cacheHitsMatch &&
                              `Cache hits mismatch (${expectedCacheHits} ≠ ${debugInfo.caching.totalCacheHits})`}
                          </div>
                        </div>
                      )
                    }
                    return null
                  })()}
                </div>

                {/* Breakdown by Operation Type */}
                <div className='space-y-1 text-[10px]'>
                  {/* Top Tracks */}
                  <div className='rounded bg-gray-800/50 p-1.5'>
                    <div className='mb-0.5 font-semibold text-gray-300'>
                      Top Tracks
                    </div>
                    <div className='grid grid-cols-3 gap-1'>
                      <div>
                        <span className='text-gray-500'>Req:</span>
                        <span className='ml-1 font-mono text-gray-300'>
                          {debugInfo.caching.topTracksRequested}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>Cache:</span>
                        <span className='ml-1 font-mono text-green-400'>
                          {debugInfo.caching.topTracksCached}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>API:</span>
                        <span className='ml-1 font-mono text-orange-400'>
                          {debugInfo.caching.topTracksFromSpotify}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Track Details */}
                  <div className='rounded bg-gray-800/50 p-1.5'>
                    <div className='mb-0.5 font-semibold text-gray-300'>
                      Track Details
                    </div>
                    <div className='grid grid-cols-3 gap-1'>
                      <div>
                        <span className='text-gray-500'>Req:</span>
                        <span className='ml-1 font-mono text-gray-300'>
                          {debugInfo.caching.trackDetailsRequested}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>Cache:</span>
                        <span className='ml-1 font-mono text-green-400'>
                          {debugInfo.caching.trackDetailsCached}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>API:</span>
                        <span className='ml-1 font-mono text-orange-400'>
                          {debugInfo.caching.trackDetailsFromSpotify}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Related Artists */}
                  <div className='rounded bg-gray-800/50 p-1.5'>
                    <div className='mb-0.5 font-semibold text-gray-300'>
                      Related Artists
                    </div>
                    <div className='grid grid-cols-3 gap-1'>
                      <div>
                        <span className='text-gray-500'>Req:</span>
                        <span className='ml-1 font-mono text-gray-300'>
                          {debugInfo.caching.relatedArtistsRequested}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>Cache:</span>
                        <span className='ml-1 font-mono text-green-400'>
                          {debugInfo.caching.relatedArtistsCached}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>API:</span>
                        <span className='ml-1 font-mono text-orange-400'>
                          {debugInfo.caching.relatedArtistsFromSpotify}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Artist Profiles */}
                  <div className='rounded bg-gray-800/50 p-1.5'>
                    <div className='mb-0.5 font-semibold text-gray-300'>
                      Artist Profiles
                    </div>
                    <div className='grid grid-cols-3 gap-1'>
                      <div>
                        <span className='text-gray-500'>Req:</span>
                        <span className='ml-1 font-mono text-gray-300'>
                          {debugInfo.caching.artistProfilesRequested}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>Cache:</span>
                        <span className='ml-1 font-mono text-green-400'>
                          {debugInfo.caching.artistProfilesCached}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>API:</span>
                        <span className='ml-1 font-mono text-orange-400'>
                          {debugInfo.caching.artistProfilesFromSpotify}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Artist Searches */}
                  <div className='rounded bg-gray-800/50 p-1.5'>
                    <div className='mb-0.5 font-semibold text-gray-300'>
                      Artist Searches
                    </div>
                    <div className='grid grid-cols-3 gap-1'>
                      <div>
                        <span className='text-gray-500'>Req:</span>
                        <span className='ml-1 font-mono text-gray-300'>
                          {debugInfo.caching.artistSearchesRequested}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>DB:</span>
                        <span className='ml-1 font-mono text-green-400'>
                          {debugInfo.caching.artistSearchesCached}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>API:</span>
                        <span className='ml-1 font-mono text-orange-400'>
                          {debugInfo.caching.artistSearchesFromSpotify}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Genre Statistics */}
          {debugInfo?.genreStatistics && (
            <section className='mb-4 border-b border-gray-700 pb-3'>
              <h3 className='mb-2 font-semibold text-gray-300'>
                Genre Statistics
              </h3>
              <div className='space-y-3'>
                {/* Overall Summary */}
                <div className='rounded bg-gray-800 p-2'>
                  <div className='mb-1 flex items-center justify-between'>
                    <span className='text-gray-400'>Genre Coverage:</span>
                    <span
                      className={`font-mono text-lg font-bold ${debugInfo.genreStatistics.percentageCoverage >= 80
                        ? 'text-green-400'
                        : debugInfo.genreStatistics.percentageCoverage >= 50
                          ? 'text-yellow-400'
                          : 'text-red-400'
                        }`}
                    >
                      {debugInfo.genreStatistics.percentageCoverage.toFixed(1)}%
                    </span>
                  </div>
                  <div className='h-2 w-full overflow-hidden rounded-full bg-gray-700'>
                    <div
                      className={`h-full transition-all duration-500 ${debugInfo.genreStatistics.percentageCoverage >= 80
                        ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                        : debugInfo.genreStatistics.percentageCoverage >= 50
                          ? 'bg-gradient-to-r from-yellow-500 to-orange-400'
                          : 'bg-gradient-to-r from-red-500 to-orange-400'
                        }`}
                      style={{
                        width: `${debugInfo.genreStatistics.percentageCoverage}%`
                      }}
                    />
                  </div>
                  <div className='mt-2 grid grid-cols-2 gap-2 text-[10px]'>
                    <div>
                      <span className='text-gray-500'>Total Tracks:</span>
                      <span className='ml-1 font-mono text-gray-300'>
                        {debugInfo.genreStatistics.totalTracks.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className='text-gray-500'>With Genres:</span>
                      <span className='ml-1 font-mono text-green-400'>
                        {debugInfo.genreStatistics.tracksWithGenres.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className='text-gray-500'>Null Genres:</span>
                      <span className='ml-1 font-mono text-red-400'>
                        {debugInfo.genreStatistics.tracksWithNullGenres.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className='text-gray-500'>Coverage:</span>
                      <span
                        className={`ml-1 font-mono ${debugInfo.genreStatistics.percentageCoverage >= 80
                          ? 'text-green-400'
                          : debugInfo.genreStatistics.percentageCoverage >= 50
                            ? 'text-yellow-400'
                            : 'text-red-400'
                          }`}
                      >
                        {debugInfo.genreStatistics.percentageCoverage.toFixed(
                          1
                        )}
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Candidate Pool Analysis */}
          {(debugInfo?.candidatePool || (debugInfo?.candidates && debugInfo.candidates.length > 0)) && (
            <section className='mb-4 border-b border-gray-700 pb-3'>
              <h3 className='mb-2 font-semibold text-gray-300'>
                Candidate Pool Analysis
              </h3>
              <div className='max-h-60 overflow-y-auto pr-1'>
                {/* 1. Seed Artists Source */}
                {debugInfo.candidatePool?.seedArtists?.map((artist) => {
                  const candidatesFromSource =
                    debugInfo.candidates?.filter(
                      (c) =>
                        c.source === 'related_top_tracks' ||
                        c.source === 'recommendations'
                    ) ?? []

                  return (
                    <div key={`seed-${artist.id}`} className='mb-3 text-xs'>
                      <div className='mb-1 flex items-center justify-between font-semibold text-blue-300'>
                        <span>From Seed: {artist.name}</span>
                        <span className='text-[10px] text-gray-500'>
                          ({artist.id})
                        </span>
                      </div>
                      <div className='pl-2'>
                        {candidatesFromSource.length > 0 ? (
                          candidatesFromSource
                            .slice(0, 10) // Limit preview per artist
                            .map((c, idx) => (
                              <div
                                key={`${artist.id}-${idx}`}
                                className='flex justify-between text-gray-400'
                              >
                                <span className='truncate pr-2'>
                                  {c.artistName} - {c.trackName}
                                </span>
                                <span className={`whitespace-nowrap ${c.filtered ? 'text-gray-600' : 'text-green-500'}`}>
                                  {c.filtered ? '[Filtered]' : c.simScore.toFixed(3)}
                                </span>
                              </div>
                            ))
                        ) : (
                          <div className='italic text-gray-600'>
                            No candidates selected
                          </div>
                        )}
                        {candidatesFromSource.length > 10 && (
                          <div className='text-[10px] italic text-gray-500'>
                            ... and {candidatesFromSource.length - 10} more
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* 2. Target Artists Source */}
                {debugInfo.candidatePool?.targetArtists?.map((artist) => {
                  const candidatesFromSource =
                    debugInfo.candidates?.filter(
                      (c) =>
                        c.source?.includes('target') || c.isTargetArtist
                    ) ?? []

                  return (
                    <div key={`target-${artist.id}`} className='mb-3 text-xs'>
                      <div className='mb-1 flex items-center justify-between font-semibold text-purple-300'>
                        <span>From Target: {artist.name}</span>
                        <span className='text-[10px] text-gray-500'>
                          ({artist.id})
                        </span>
                      </div>
                      <div className='pl-2'>
                        {candidatesFromSource.length > 0 ? (
                          candidatesFromSource.map((c, idx) => (
                            <div
                              key={`${artist.id}-${idx}`}
                              className='flex justify-between text-gray-400'
                            >
                              <span className='truncate pr-2'>
                                {c.artistName} - {c.trackName}
                              </span>
                              <span className={`whitespace-nowrap ${c.filtered ? 'text-gray-600' : 'text-purple-500'}`}>
                                {c.filtered ? '[Filtered]' : c.simScore.toFixed(3)}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className='italic text-gray-600'>
                            No candidates Injected
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* 3. Fallback / Other candidates not matched above (or if no pool info) */}
                {(!debugInfo.candidatePool?.seedArtists?.length && !debugInfo.candidatePool?.targetArtists?.length) && debugInfo.candidates && (
                  <div className='space-y-1 text-xs'>
                    <div className='mb-1 font-semibold text-gray-400'>All Candidates</div>
                    {debugInfo.candidates.slice(0, 50).map((candidate, idx) => {
                      const status = candidate.filtered
                        ? '[FILTERED]'
                        : candidate.isTargetArtist
                          ? '[TARGET]'
                          : '[ALLOWED]'
                      const source = candidate.source ? `[${candidate.source}]` : ''
                      return (
                        <div key={idx} className='text-gray-400'>
                          {idx + 1}. {candidate.artistName} - {candidate.trackName ?? 'Unknown'} {source} {status} | Sim: {(candidate.simScore ?? 0).toFixed(3)}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Performance Timing */}
          {debugInfo?.performanceDiagnostics && (
            <section className='mb-4 border-b border-gray-700 pb-3'>
              <h3 className='mb-2 font-semibold text-gray-300'>
                ⚡ Performance Timing
              </h3>

              {/* Total Execution Time */}
              <div className='mb-2 rounded bg-gray-800 p-2'>
                <div className='mb-1 flex items-center justify-between'>
                  <span className='text-gray-400'>Total Execution:</span>
                  <span className='font-mono text-lg font-bold text-cyan-400'>
                    {debugInfo.timingBreakdown?.totalMs.toLocaleString()}ms
                  </span>
                </div>
              </div>

              {/* Phase Breakdown */}
              {debugInfo.timingBreakdown && (
                <div className='mb-2 space-y-1 text-[10px]'>
                  <div className='font-semibold text-gray-300'>
                    Phase Breakdown:
                  </div>
                  {[
                    {
                      label: 'Candidate Pool',
                      ms: debugInfo.timingBreakdown.candidatePoolMs
                    },
                    {
                      label: 'Target Resolution',
                      ms: debugInfo.timingBreakdown.targetResolutionMs
                    },
                    {
                      label: 'Enrichment',
                      ms: debugInfo.timingBreakdown.enrichmentMs
                    },
                    {
                      label: 'Scoring',
                      ms: debugInfo.timingBreakdown.scoringMs
                    },
                    {
                      label: 'Selection',
                      ms: debugInfo.timingBreakdown.selectionMs
                    }
                  ].map(({ label, ms }) => {
                    const percentage =
                      debugInfo.timingBreakdown!.totalMs > 0
                        ? (
                          (ms / debugInfo.timingBreakdown!.totalMs) *
                          100
                        ).toFixed(1)
                        : '0.0'
                    const isBottleneck =
                      label ===
                      debugInfo.performanceDiagnostics!.bottleneckPhase
                    return (
                      <div
                        key={label}
                        className={`flex items-center justify-between rounded px-1.5 py-0.5 ${isBottleneck ? 'bg-red-900/30' : 'bg-gray-800/50'}`}
                      >
                        <span
                          className={
                            isBottleneck
                              ? 'font-bold text-red-400'
                              : 'text-gray-400'
                          }
                        >
                          {label}
                          {isBottleneck ? ' 🔴' : ''}:
                        </span>
                        <span
                          className={`font-mono ${isBottleneck ? 'font-bold text-red-400' : 'text-gray-300'}`}
                        >
                          {ms}ms ({percentage}%)
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Database Queries */}
              {debugInfo.performanceDiagnostics.dbQueries.length > 0 && (
                <div className='mb-2 rounded bg-blue-900/20 p-2'>
                  <div className='mb-1 flex items-center justify-between text-[10px]'>
                    <span className='font-semibold text-blue-300'>
                      Database Queries (
                      {debugInfo.performanceDiagnostics.dbQueries.length})
                    </span>
                    <span className='font-mono font-bold text-blue-400'>
                      {debugInfo.performanceDiagnostics.totalDbTimeMs}ms
                    </span>
                  </div>
                  <div className='max-h-32 space-y-0.5 overflow-y-auto text-[9px]'>
                    {debugInfo.performanceDiagnostics.dbQueries.map(
                      (query, idx) => (
                        <div
                          key={idx}
                          className='flex items-center justify-between'
                        >
                          <span className='truncate text-gray-400'>
                            {query.operation}
                          </span>
                          <span className='ml-2 font-mono text-blue-300'>
                            {query.durationMs}ms
                          </span>
                        </div>
                      )
                    )}
                  </div>
                  {debugInfo.performanceDiagnostics.slowestDbQuery && (
                    <div className='mt-1 rounded bg-red-900/30 px-1.5 py-0.5 text-[9px]'>
                      <span className='text-red-400'>Slowest: </span>
                      <span className='text-gray-300'>
                        {
                          debugInfo.performanceDiagnostics.slowestDbQuery
                            .operation
                        }
                      </span>
                      <span className='ml-1 font-mono font-bold text-red-400'>
                        {
                          debugInfo.performanceDiagnostics.slowestDbQuery
                            .durationMs
                        }
                        ms
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* API Calls */}
              {debugInfo.performanceDiagnostics.apiCalls.length > 0 && (
                <div className='mb-2 rounded bg-orange-900/20 p-2'>
                  <div className='mb-1 flex items-center justify-between text-[10px]'>
                    <span className='font-semibold text-orange-300'>
                      Spotify API Calls (
                      {debugInfo.performanceDiagnostics.apiCalls.length})
                    </span>
                    <span className='font-mono font-bold text-orange-400'>
                      {debugInfo.performanceDiagnostics.totalApiTimeMs}ms
                    </span>
                  </div>
                  <div className='max-h-32 space-y-0.5 overflow-y-auto text-[9px]'>
                    {debugInfo.performanceDiagnostics.apiCalls.map(
                      (call, idx) => (
                        <div
                          key={idx}
                          className='flex items-center justify-between'
                        >
                          <span className='truncate text-gray-400'>
                            {call.operation}
                          </span>
                          <span className='ml-2 font-mono text-orange-300'>
                            {call.durationMs}ms
                          </span>
                        </div>
                      )
                    )}
                  </div>
                  {debugInfo.performanceDiagnostics.slowestApiCall && (
                    <div className='mt-1 rounded bg-red-900/30 px-1.5 py-0.5 text-[9px]'>
                      <span className='text-red-400'>Slowest: </span>
                      <span className='text-gray-300'>
                        {
                          debugInfo.performanceDiagnostics.slowestApiCall
                            .operation
                        }
                      </span>
                      <span className='ml-1 font-mono font-bold text-red-400'>
                        {
                          debugInfo.performanceDiagnostics.slowestApiCall
                            .durationMs
                        }
                        ms
                      </span>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Target Artists */}
          <section className='mb-4 border-b border-gray-700 pb-3'>
            <h3 className='mb-2 font-semibold text-gray-300'>Target Artists</h3>
            <div className='space-y-1 text-gray-400'>
              <div className='flex items-center justify-between'>
                <span>Player 1:</span>
                <span className='font-mono text-blue-400'>
                  {players?.find((p) => p.id === 'player1')?.targetArtist
                    ?.name ?? 'None'}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span>Player 2:</span>
                <span className='font-mono text-green-400'>
                  {players?.find((p) => p.id === 'player2')?.targetArtist
                    ?.name ?? 'None'}
                </span>
              </div>
            </div>
          </section>

          {/* Debug Information */}
          {debugInfo && (
            <section className='mb-4 border-b border-gray-700 pb-3'>
              <h3 className='mb-2 font-semibold text-gray-300'>
                Debug Information
              </h3>
              <div className='space-y-3 text-xs'>
                {/* Target Profiles */}
                <div>
                  <h4 className='mb-1 font-medium text-gray-400'>
                    Target Profiles
                  </h4>
                  <div className='space-y-1 pl-2 text-gray-500'>
                    <div className='flex items-center justify-between'>
                      <span>Player 1:</span>
                      <span
                        className={
                          debugInfo.targetProfiles?.player1?.resolved
                            ? 'text-green-400'
                            : 'text-red-400'
                        }
                      >
                        {debugInfo.targetProfiles?.player1?.resolved
                          ? 'Resolved'
                          : 'NOT RESOLVED'}
                      </span>
                    </div>
                    {debugInfo.targetProfiles?.player1?.resolved && (
                      <div className='pl-2 text-[10px]'>
                        <div>
                          Artist:{' '}
                          {debugInfo.targetProfiles?.player1.artistName ??
                            'N/A'}
                        </div>
                        <div>
                          Spotify ID:{' '}
                          {debugInfo.targetProfiles?.player1.spotifyId ?? 'N/A'}
                        </div>
                        <div>
                          Genres:{' '}
                          {debugInfo.targetProfiles?.player1.genresCount}
                        </div>
                      </div>
                    )}
                    <div className='flex items-center justify-between'>
                      <span>Player 2:</span>
                      <span
                        className={
                          debugInfo.targetProfiles?.player2?.resolved
                            ? 'text-green-400'
                            : 'text-red-400'
                        }
                      >
                        {debugInfo.targetProfiles?.player2?.resolved
                          ? 'Resolved'
                          : 'NOT RESOLVED'}
                      </span>
                    </div>
                    {debugInfo.targetProfiles?.player2?.resolved && (
                      <div className='pl-2 text-[10px]'>
                        <div>
                          Artist:{' '}
                          {debugInfo.targetProfiles?.player2.artistName ??
                            'N/A'}
                        </div>
                        <div>
                          Spotify ID:{' '}
                          {debugInfo.targetProfiles?.player2.spotifyId ?? 'N/A'}
                        </div>
                        <div>
                          Genres:{' '}
                          {debugInfo.targetProfiles?.player2.genresCount}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Artist Profiles - Robust Fallback */}
                <div>
                  <h4 className='mb-1 font-medium text-gray-400'>
                    Artist Profiles
                  </h4>
                  <div className='space-y-1 pl-2 text-gray-500'>
                    {debugInfo.artistProfiles ? (
                      <>
                        <div className='flex items-center justify-between'>
                          <span>Requested:</span>
                          <span className='font-mono text-gray-300'>
                            {debugInfo.artistProfiles.requested}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span>Fetched:</span>
                          <span className='font-mono text-green-400'>
                            {debugInfo.artistProfiles.fetched}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span>Missing:</span>
                          <span
                            className={`font-mono ${debugInfo.artistProfiles.missing > 0 ? 'text-red-400' : 'text-gray-500'}`}
                          >
                            {debugInfo.artistProfiles.missing}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span>Success Rate:</span>
                          <span className='font-mono text-blue-400'>
                            {debugInfo.artistProfiles.successRate.toFixed(1)}%
                          </span>
                        </div>
                      </>
                    ) : debugInfo.caching ? (
                      <>
                        <div className='flex items-center justify-between'>
                          <span>Requested:</span>
                          <span className='font-mono text-gray-300'>
                            {debugInfo.caching.artistProfilesRequested}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span>Resolved:</span>
                          <span className='font-mono text-green-400'>
                            {debugInfo.caching.artistProfilesCached +
                              debugInfo.caching.artistProfilesFromSpotify}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span>Cache Rate:</span>
                          <span className='font-mono text-blue-400'>
                            {(
                              (debugInfo.caching.artistProfilesCached /
                                (debugInfo.caching.artistProfilesRequested ||
                                  1)) *
                              100
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className='italic text-gray-600'>
                        No profile stats available
                      </div>
                    )}
                  </div>
                </div>

                {/* Scoring */}
                <div>
                  <h4 className='mb-1 font-medium text-gray-400'>Scoring</h4>
                  <div className='space-y-1 pl-2 text-gray-500'>
                    <div className='flex items-center justify-between'>
                      <span>Candidates:</span>
                      <span className='font-mono text-gray-300'>
                        {debugInfo.scoring?.totalCandidates ?? 0}
                      </span>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span>Fallbacks:</span>
                      <span className='font-mono text-yellow-400'>
                        {debugInfo.scoring?.fallbackFetches ?? 0}
                      </span>
                    </div>
                  </div>
                  {debugInfo.scoring && (
                    <div className='mt-1 space-y-1 pl-2 text-[10px] text-gray-600'>
                      <div className='flex justify-between'>
                        <span>P1 Attraction:</span>
                        <span>{debugInfo.scoring.p1NonZeroAttraction}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span>P2 Attraction:</span>
                        <span>{debugInfo.scoring.p2NonZeroAttraction}</span>
                      </div>
                    </div>
                  )}
                  <div className='mt-1 border-t border-gray-700 pt-1'>
                    <div className='text-[10px] font-medium text-gray-400'>
                      Zero Attraction Reasons:
                    </div>
                    <div className='pl-2 text-[10px]'>
                      <div className='flex items-center justify-between'>
                        <span>Missing Artist Profile:</span>
                        <span className='font-mono text-red-400'>
                          {debugInfo.scoring?.zeroAttractionReasons
                            ?.missingArtistProfile ?? 0}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span>Null Target Profile:</span>
                        <span className='font-mono text-red-400'>
                          {debugInfo.scoring?.zeroAttractionReasons
                            ?.nullTargetProfile ?? 0}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span>Zero Similarity:</span>
                        <span className='font-mono text-orange-400'>
                          {debugInfo.scoring?.zeroAttractionReasons
                            ?.zeroSimilarity ?? 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Candidates List */}
                {debugInfo.candidates && debugInfo.candidates.length > 0 && (
                  <div>
                    <h4 className='mb-1 font-medium text-gray-400'>
                      All Candidates ({debugInfo.candidates.length})
                    </h4>
                    <div className='max-h-48 space-y-1 overflow-y-auto pl-2 text-[10px] text-gray-500'>
                      {debugInfo.candidates.map((candidate, idx) => (
                        <div
                          key={idx}
                          className={`flex items-center justify-between rounded px-1 py-1 ${candidate.filtered
                            ? 'bg-red-900/20 text-red-400'
                            : candidate.isTargetArtist
                              ? 'bg-yellow-900/20 text-yellow-400'
                              : 'text-gray-400'
                            }`}
                        >
                          <div className='flex w-full flex-col overflow-hidden pr-2'>
                            <div className='flex items-center space-x-1'>
                              <span
                                className='truncate font-medium'
                                title={candidate.artistName}
                              >
                                {candidate.artistName}
                              </span>
                              {candidate.isTargetArtist && (
                                <span className='whitespace-nowrap text-[9px] opacity-75'>
                                  (Target)
                                </span>
                              )}
                              {candidate.filtered && (
                                <span className='whitespace-nowrap text-[9px] opacity-75'>
                                  (Filtered)
                                </span>
                              )}
                            </div>
                            <div
                              className='truncate text-[9px] opacity-60'
                              title={`${candidate.trackName} [${candidate.source}]`}
                            >
                              {candidate.trackName}{' '}
                              {candidate.source ? `[${candidate.source}]` : ''}
                            </div>
                          </div>
                          <span className='whitespace-nowrap font-mono text-gray-300'>
                            {candidate.simScore.toFixed(3)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Option Track Metrics */}
          <section>
            <h3 className='mb-2 font-semibold text-gray-300'>
              Track Metrics ({options.length})
            </h3>
            {options[0]?.metrics?.currentSongAttraction !== undefined && (
              <div className='mb-2 text-[10px] text-gray-400'>
                Baseline (Current Song → {activePlayerId ?? 'active'} target):{' '}
                <span className='font-mono text-yellow-400'>
                  {options[0].metrics.currentSongAttraction.toFixed(3)}
                </span>
              </div>
            )}
            <div className='space-y-3'>
              {options.map((option, index) => {
                const metrics = option.metrics
                if (!metrics) return null

                // Determine category - use selectionCategory if available, otherwise compute from attraction
                const currentPlayerAttraction =
                  activePlayerId === 'player1'
                    ? metrics.aAttraction
                    : metrics.bAttraction
                const baseline = metrics.currentSongAttraction
                const NEUTRAL_TOLERANCE = 0.02 // 2% tolerance for neutral zone (matches server-side)
                let category: 'CLOSER' | 'NEUTRAL' | 'FURTHER' = 'NEUTRAL'
                let categoryColor = 'text-gray-400'

                // Use selectionCategory if available (assigned during selection), otherwise compute
                if (metrics.selectionCategory) {
                  category = metrics.selectionCategory.toUpperCase() as
                    | 'CLOSER'
                    | 'NEUTRAL'
                    | 'FURTHER'
                  categoryColor =
                    category === 'CLOSER'
                      ? 'text-green-400'
                      : category === 'FURTHER'
                        ? 'text-red-400'
                        : 'text-gray-400'
                } else if (
                  baseline !== undefined &&
                  currentPlayerAttraction !== undefined
                ) {
                  // Fallback to computed category for backwards compatibility
                  const diff = currentPlayerAttraction - baseline
                  if (diff > NEUTRAL_TOLERANCE) {
                    category = 'CLOSER'
                    categoryColor = 'text-green-400'
                  } else if (diff < -NEUTRAL_TOLERANCE) {
                    category = 'FURTHER'
                    categoryColor = 'text-red-400'
                  } else {
                    category = 'NEUTRAL'
                    categoryColor = 'text-gray-400'
                  }
                }

                return (
                  <div
                    key={index}
                    className='rounded border border-gray-700 bg-gray-800 p-2'
                  >
                    <div className='mb-1 flex items-center justify-between'>
                      <span className='text-[10px] font-medium text-gray-400'>
                        Option {index + 1}{' '}
                        <span className={categoryColor}>[{category}]</span>
                      </span>
                      {metrics.forceReason && (
                        <span className='rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400'>
                          {metrics.forceReason}
                        </span>
                      )}
                    </div>
                    {(option.track?.name ?? option.artist?.name) && (
                      <div className='mb-2 space-y-0.5 border-b border-gray-700 pb-2 text-[10px]'>
                        {option.artist?.name && (
                          <div className='flex items-center justify-between'>
                            <span className='text-gray-500'>Artist:</span>
                            <span className='select-all font-medium text-gray-300'>
                              {option.artist.name}
                            </span>
                          </div>
                        )}
                        {option.track?.name && (
                          <div className='flex items-center justify-between'>
                            <span className='text-gray-500'>Track:</span>
                            <span
                              className='ml-2 select-all truncate text-gray-400'
                              title={option.track.name}
                            >
                              {option.track.name}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className='grid grid-cols-2 gap-1 text-[10px] text-gray-400'>
                      <div>
                        <span className='text-gray-500'>Sim:</span>{' '}
                        <span className='font-mono'>
                          {formatScore(metrics.simScore)}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>Final:</span>{' '}
                        <span className='font-mono text-gray-300'>
                          {formatScore(metrics.finalScore)}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>A Attract:</span>{' '}
                        <span className='font-mono text-blue-400'>
                          {formatScore(metrics.aAttraction)}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>B Attract:</span>{' '}
                        <span className='font-mono text-green-400'>
                          {formatScore(metrics.bAttraction)}
                        </span>
                      </div>
                      {baseline !== undefined &&
                        currentPlayerAttraction !== undefined && (
                          <>
                            <div>
                              <span className='text-gray-500'>Attraction:</span>{' '}
                              <span className='font-mono text-cyan-400'>
                                {formatScore(currentPlayerAttraction)}
                              </span>
                            </div>
                            <div>
                              <span className='text-gray-500'>Baseline:</span>{' '}
                              <span className='font-mono text-yellow-400'>
                                {formatScore(baseline)}
                              </span>
                            </div>
                            <div>
                              <span className='text-gray-500'>Diff:</span>{' '}
                              <span className={`font-mono ${categoryColor}`}>
                                {(currentPlayerAttraction - baseline).toFixed(
                                  3
                                )}
                              </span>
                            </div>
                          </>
                        )}
                      <div>
                        <span className='text-gray-500'>Gravity:</span>{' '}
                        <span className='font-mono'>
                          {formatScore(metrics.gravityScore)}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>Popularity:</span>{' '}
                        <span className='capitalize'>
                          {metrics.popularityBand}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>P1 Distance:</span>{' '}
                        <span
                          className={`font-mono ${getDistanceColor(
                            metrics.vicinityDistances?.player1
                          )}`}
                        >
                          {formatDistance(metrics.vicinityDistances?.player1)}
                        </span>
                      </div>
                      <div>
                        <span className='text-gray-500'>P2 Distance:</span>{' '}
                        <span
                          className={`font-mono ${getDistanceColor(
                            metrics.vicinityDistances?.player2
                          )}`}
                        >
                          {formatDistance(metrics.vicinityDistances?.player2)}
                        </span>
                      </div>
                    </div>

                    {/* Score Components & Detailed Breakdown */}
                    {metrics.scoreComponents && (
                      <div className='mt-2 border-t border-gray-700 pt-1'>
                        <div className='mb-1 text-[10px] font-semibold text-gray-400'>
                          Score Components
                        </div>
                        <div className='grid grid-cols-2 gap-1 text-[10px] text-gray-400'>
                          <div title='Weighted 40%'>
                            Genre:{' '}
                            <span className='text-gray-300'>
                              {metrics.scoreComponents.genre?.score?.toFixed(3)}
                            </span>
                          </div>
                          <div title='Weighted 30%'>
                            Rel:{' '}
                            <span className='text-gray-300'>
                              {metrics.scoreComponents.relationship?.toFixed(3)}
                            </span>
                          </div>
                          <div title='Weighted 15%'>
                            ArtPop:{' '}
                            <span className='text-gray-300'>
                              {metrics.scoreComponents.artistPop?.toFixed(3)}
                            </span>
                          </div>
                          <div title='Weighted 15%'>
                            Foll:{' '}
                            <span className='text-gray-300'>
                              {metrics.scoreComponents.followers?.toFixed(3)}
                            </span>
                          </div>
                        </div>

                        {/* Genre Details */}
                        {metrics.scoreComponents.genre &&
                          typeof metrics.scoreComponents.genre !== 'number' && (
                            <div className='mt-2 rounded bg-gray-900/50 p-1.5'>
                              <div className='mb-1 text-[9px] font-semibold uppercase tracking-wider text-gray-500'>
                                Genre Analysis
                              </div>

                              {/* Raw Lists */}
                              <div className='mb-2 font-mono text-[9px]'>
                                <div className='mb-1'>
                                  <span className='mb-0.5 block text-gray-500'>
                                    Target Genres:
                                  </span>
                                  <div className='break-all rounded bg-gray-800/50 p-1 leading-tight text-gray-300'>
                                    {metrics.scoreComponents.genre.targetGenres
                                      ?.length ? (
                                      metrics.scoreComponents.genre.targetGenres.join(
                                        ', '
                                      )
                                    ) : (
                                      <span className='italic text-gray-600'>
                                        None
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <span className='mb-0.5 block text-gray-500'>
                                    Candidate Genres:
                                  </span>
                                  <div className='break-all rounded bg-gray-800/50 p-1 leading-tight text-gray-300'>
                                    {metrics.scoreComponents.genre
                                      .candidateGenres?.length ? (
                                      metrics.scoreComponents.genre.candidateGenres.join(
                                        ', '
                                      )
                                    ) : (
                                      <span className='italic text-gray-600'>
                                        None
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Matches */}
                              {metrics.scoreComponents.genre.details.length >
                                0 ? (
                                <div className='mt-1 space-y-0.5 border-t border-gray-800 pt-1'>
                                  <div className='mb-0.5 text-[9px] text-gray-500'>
                                    Top Matches:
                                  </div>
                                  {metrics.scoreComponents.genre.details
                                    .slice(0, 3)
                                    .map((d, i) => (
                                      <div
                                        key={i}
                                        className='font-mono text-[9px] text-gray-400'
                                      >
                                        {d.candidateGenre} → {d.bestMatchGenre}{' '}
                                        <span className='text-gray-500'>
                                          ({d.score.toFixed(2)})
                                        </span>
                                      </div>
                                    ))}
                                  {metrics.scoreComponents.genre.details
                                    .length > 3 && (
                                      <div className='text-[8px] italic text-gray-600'>
                                        +{' '}
                                        {metrics.scoreComponents.genre.details
                                          .length - 3}{' '}
                                        more
                                      </div>
                                    )}
                                </div>
                              ) : (
                                <div className='mt-1 text-[9px] italic text-gray-500'>
                                  No meaningful matches found
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
