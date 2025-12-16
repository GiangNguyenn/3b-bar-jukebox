import { createModuleLogger } from '@/shared/utils/logger'
import {
  CandidateTrackMetrics,
  PlayerGravityMap,
  PlayerId,
  TargetProfile,
  CategoryQuality,
  CATEGORY_WEIGHTS,
  GUARANTEED_MINIMUMS,
  MIN_QUALITY_THRESHOLDS,
  MAX_ROUND_TURNS,
  GRAVITY_LIMITS,
  DISPLAY_OPTION_COUNT,
  PopularityBand
} from './dgsTypes'

const TRACKS_PER_CATEGORY = 3

const logger = createModuleLogger('DgsDiversity')

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export function applyDiversityConstraints(
  metrics: CandidateTrackMetrics[],
  roundNumber: number,
  targetProfiles: Record<PlayerId, TargetProfile | null>,
  playerGravities: PlayerGravityMap,
  currentPlayerId: PlayerId,
  forceHardConvergence?: boolean
): {
  selected: CandidateTrackMetrics[]
  filteredArtistNames: Set<string>
} {
  const artistIds = new Set<string>()
  const selected: CandidateTrackMetrics[] = []
  const hardConvergenceActive =
    forceHardConvergence ?? roundNumber >= MAX_ROUND_TURNS
  const SIMILARITY_THRESHOLD = 0.4

  logger(
    'INFO',
    `Applying diversity constraints: Round=${roundNumber} | Threshold=${SIMILARITY_THRESHOLD} | HardConvergence=${hardConvergenceActive} | InputCandidates=${metrics.length}`,
    'applyDiversityConstraints'
  )

  // Track which artists were filtered
  const filteredArtistNames = new Set<string>()

  // Filter out target artists in early rounds unless they're actually related
  const filteredMetrics = metrics.filter((metric) => {
    // In round 10+, allow all target artists naturally
    if (hardConvergenceActive) {
      return true
    }

    // Check if this candidate is a target artist
    const candidateArtistName = normalizeName(metric.artistName ?? '')
    let isTargetArtist = false
    let targetPlayerId: PlayerId | null = null

    for (const [pid, target] of Object.entries(targetProfiles)) {
      if (!target) continue
      if (normalizeName(target.artist.name) === candidateArtistName) {
        isTargetArtist = true
        targetPlayerId = pid as PlayerId
        break
      }
    }

    // If not a target artist, allow it
    if (!isTargetArtist) {
      return true
    }

    // CHECK OVERRIDES: Target Boost (Round 8+) OR High Influence (>= 0.7)
    // If either condition is met, we ALLOW the target artist regardless of similarity
    const roundOverride = roundNumber >= 8
    const gravityOverride =
      targetPlayerId && playerGravities[targetPlayerId] >= GRAVITY_LIMITS.max

    if (roundOverride || gravityOverride) {
      logger(
        'INFO',
        `Allowed target artist via override: ${metric.artistName} (Round=${roundNumber}, Gravity=${targetPlayerId ? playerGravities[targetPlayerId].toFixed(2) : '?'})`,
        'applyDiversityConstraints'
      )
      return true
    }

    // If it's a target artist in early rounds (and no override), only allow if similarity is high (actually related)
    const allowed = metric.simScore > SIMILARITY_THRESHOLD
    if (!allowed) {
      filteredArtistNames.add(metric.artistName ?? 'Unknown')
      logger(
        'INFO',
        `Filtered target artist: ${metric.artistName} (Sim=${metric.simScore.toFixed(3)} < ${SIMILARITY_THRESHOLD})`,
        'applyDiversityConstraints'
      )
    } else {
      logger(
        'INFO',
        `Allowed target artist: ${metric.artistName} (Sim=${metric.simScore.toFixed(3)} >= ${SIMILARITY_THRESHOLD})`,
        'applyDiversityConstraints'
      )
    }
    return allowed
  })

  const filteredCount = metrics.length - filteredMetrics.length
  if (filteredCount > 0) {
    logger(
      'INFO',
      `Filtered ${filteredCount} target artists in early rounds (${filteredMetrics.length} remaining)`,
      'applyDiversityConstraints'
    )
  }

  // Sort by finalScore descending to ensure we select the best candidates
  const sortedFilteredMetrics = [...filteredMetrics].sort(
    (a, b) => b.finalScore - a.finalScore
  )

  // Get the appropriate attraction value based on current player
  const getCurrentPlayerAttraction = (
    metric: CandidateTrackMetrics
  ): number => {
    return currentPlayerId === 'player1'
      ? metric.aAttraction
      : metric.bAttraction
  }

  // Calculate differences from baseline for all candidates
  const candidatesWithDiff = sortedFilteredMetrics.map((m) => ({
    metric: m,
    diff: getCurrentPlayerAttraction(m) - m.currentSongAttraction,
    attraction: getCurrentPlayerAttraction(m),
    baseline: m.currentSongAttraction
  }))

  // Sort by difference (positive = closer, negative = further)
  candidatesWithDiff.sort((a, b) => b.diff - a.diff)

  // Calculate baseline early - it's the same for all candidates
  const baseline = candidatesWithDiff[0]?.metric.currentSongAttraction ?? 0

  // Define tolerance for "neutral" - options within this margin are considered neutral
  // Increased from 0.01 to 0.02 (2%) to create a wider neutral zone for better gameplay
  // This prevents tracks that are barely different from baseline from being categorized as FURTHER
  const NEUTRAL_TOLERANCE = 0.02 // 2% tolerance for neutral zone

  // Calculate the actual range of differences to better understand distribution
  const diffs = candidatesWithDiff.map((item) => item.diff)
  const minDiff = Math.min(...diffs)
  const maxDiff = Math.max(...diffs)
  const diffRange = maxDiff - minDiff

  // Use adaptive tolerance based on actual distribution
  // If differences are very small (tightly clustered), use a smaller tolerance
  // If differences are large, use the standard tolerance
  const adaptiveTolerance =
    diffRange < 0.1
      ? Math.max(0.015, diffRange * 0.2) // 20% of range, min 0.015
      : NEUTRAL_TOLERANCE

  logger(
    'INFO',
    `Difference range: ${minDiff.toFixed(3)} to ${maxDiff.toFixed(3)} (range=${diffRange.toFixed(3)}), using tolerance=${adaptiveTolerance.toFixed(3)}`,
    'applyDiversityConstraints'
  )

  // Calculate quality scores for category validation
  function calculateCategoryQuality(
    candidates: CandidateTrackMetrics[],
    baseline: number,
    currentPlayerId: 'player1' | 'player2'
  ): CategoryQuality {
    if (candidates.length === 0) {
      return {
        averageAttractionDelta: 0,
        diversityScore: 0,
        popularitySpread: 0,
        genreVariety: 0,
        qualityScore: 0
      }
    }

    // Average attraction delta from baseline
    const attractionDeltas = candidates.map((c) => {
      const currentPlayerAttraction =
        currentPlayerId === 'player1' ? c.aAttraction : c.bAttraction
      return currentPlayerAttraction - baseline
    })
    const averageAttractionDelta =
      attractionDeltas.reduce((a, b) => a + b, 0) / attractionDeltas.length

    // Artist diversity (unique artists / total tracks)
    const uniqueArtists = new Set(
      candidates.map((c) => c.artistId).filter(Boolean)
    )
    const diversityScore = uniqueArtists.size / candidates.length

    // Popularity spread (presence of low/mid/high bands)
    const popularityBands = candidates.reduce(
      (acc, c) => {
        acc[c.popularityBand] = (acc[c.popularityBand] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )
    const bandPresence =
      (popularityBands.low ? 1 : 0) +
      (popularityBands.mid ? 1 : 0) +
      (popularityBands.high ? 1 : 0)
    const popularitySpread = bandPresence / 3

    // Genre variety (unique genres / total tracks)
    const allGenres = new Set<string>()
    candidates.forEach((c) => {
      if (c.artistGenres) {
        c.artistGenres.forEach((genre) => allGenres.add(genre))
      }
    })
    const genreVariety = allGenres.size / candidates.length

    // Overall quality score (weighted average)
    const qualityScore =
      Math.abs(averageAttractionDelta) * 0.4 + // Attraction strength
      diversityScore * 0.3 + // Artist diversity
      popularitySpread * 0.15 + // Popularity variety
      genreVariety * 0.15 // Genre variety

    return {
      averageAttractionDelta,
      diversityScore,
      popularitySpread,
      genreVariety,
      qualityScore
    }
  }

  // First, identify candidates that are actually closer/further/neutral
  const actuallyCloser = candidatesWithDiff
    .filter((item) => item.diff > adaptiveTolerance)
    .map((item) => item.metric)

  const actuallyFurther = candidatesWithDiff
    .filter((item) => item.diff < -adaptiveTolerance)
    .map((item) => item.metric)

  const actuallyNeutral = candidatesWithDiff
    .filter((item) => Math.abs(item.diff) <= adaptiveTolerance)
    .map((item) => item.metric)

  // Goal: Get 3 from each category
  // Strategy: Use actual closer/further first, then use percentile-based selection from remaining
  const TARGET_PER_CATEGORY = 3

  // Use percentile-based approach to ensure we get 3 from each category
  // Split into thirds based on difference from baseline
  const totalCandidates = candidatesWithDiff.length
  const thirdSize = Math.max(
    TARGET_PER_CATEGORY,
    Math.floor(totalCandidates / 3)
  )

  // Top third = closer (positive differences, sorted descending)
  // Use adaptive tolerance for filtering
  const topThird = candidatesWithDiff
    .filter((item) => item.diff > adaptiveTolerance)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, thirdSize)
    .map((item) => item.metric)

  // Bottom third = further (negative differences, sorted ascending)
  const bottomThird = candidatesWithDiff
    .filter((item) => item.diff < -adaptiveTolerance)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, thirdSize)
    .map((item) => item.metric)

  // Middle = neutral (within tolerance of baseline)
  const middleThird = candidatesWithDiff
    .filter((item) => Math.abs(item.diff) <= adaptiveTolerance)
    .map((item) => item.metric)

  // If we don't have enough in a category, expand from adjacent categories
  const goodCandidates: CandidateTrackMetrics[] = [...topThird]
  const badCandidates: CandidateTrackMetrics[] = [...bottomThird]
  let neutralCandidates: CandidateTrackMetrics[] = [...middleThird]

  // Ensure we have at least TARGET_PER_CATEGORY in each
  // Use percentile-based approach when categories are insufficient
  // Special handling: If all differences are negative (all candidates are "further"),
  // the top third (least negative) should still be treated as "closer" for gameplay
  if (goodCandidates.length < TARGET_PER_CATEGORY) {
    // Check quality of current closer candidates before expanding
    const closerQuality = calculateCategoryQuality(
      goodCandidates,
      baseline,
      currentPlayerId
    )
    const minQualityThreshold = MIN_QUALITY_THRESHOLDS.closer

    if (closerQuality.qualityScore < minQualityThreshold) {
      logger(
        'WARN',
        `Closer category quality (${closerQuality.qualityScore.toFixed(3)}) below threshold (${minQualityThreshold}). Current: delta=${closerQuality.averageAttractionDelta.toFixed(3)}, diversity=${closerQuality.diversityScore.toFixed(3)}, popularity=${closerQuality.popularitySpread.toFixed(3)}, genres=${closerQuality.genreVariety.toFixed(3)}`,
        'applyDiversityConstraints'
      )
    }

    // If we don't have enough genuine "closer" tracks, use percentile approach
    // Take top third of all candidates by difference (best relative to baseline)
    // When all differences are negative, this gives us the "least further" options
    const percentileCloser = candidatesWithDiff
      .sort((a, b) => b.diff - a.diff) // Sort by diff descending (best first)
      .slice(0, Math.max(thirdSize, TARGET_PER_CATEGORY * 2))
      .filter((item) => !goodCandidates.includes(item.metric))
      .slice(0, TARGET_PER_CATEGORY * 2 - goodCandidates.length)
      .map((item) => item.metric)

    goodCandidates.push(...percentileCloser)

    // Check quality after expansion
    const expandedCloserQuality = calculateCategoryQuality(
      goodCandidates,
      baseline,
      currentPlayerId
    )
    const qualityImproved =
      expandedCloserQuality.qualityScore > closerQuality.qualityScore

    // Check if all differences are negative for logging
    const allNegative = maxDiff <= 0
    if (allNegative) {
      logger(
        'WARN',
        `All candidates are "further" (max diff=${maxDiff.toFixed(3)}). Using top third as "closer" for gameplay balance. Expanded closer category: ${goodCandidates.length} candidates (added ${percentileCloser.length} via percentile). Quality: ${expandedCloserQuality.qualityScore.toFixed(3)} (${qualityImproved ? 'improved' : 'degraded'})`,
        'applyDiversityConstraints'
      )
    } else {
      logger(
        'INFO',
        `Expanded closer category: ${goodCandidates.length} candidates (added ${percentileCloser.length} via percentile). Quality: ${expandedCloserQuality.qualityScore.toFixed(3)} (${qualityImproved ? 'improved' : 'degraded'})`,
        'applyDiversityConstraints'
      )
    }
  }

  if (badCandidates.length < TARGET_PER_CATEGORY) {
    // Check quality of current further candidates before expanding
    const furtherQuality = calculateCategoryQuality(
      badCandidates,
      baseline,
      currentPlayerId
    )
    const minQualityThreshold = MIN_QUALITY_THRESHOLDS.further

    if (
      Math.abs(furtherQuality.averageAttractionDelta) <
      Math.abs(minQualityThreshold)
    ) {
      logger(
        'WARN',
        `Further category quality (${furtherQuality.qualityScore.toFixed(3)}) below threshold (${minQualityThreshold}). Current: delta=${furtherQuality.averageAttractionDelta.toFixed(3)}, diversity=${furtherQuality.diversityScore.toFixed(3)}, popularity=${furtherQuality.popularitySpread.toFixed(3)}, genres=${furtherQuality.genreVariety.toFixed(3)}`,
        'applyDiversityConstraints'
      )
    }

    // If we don't have enough genuine "further" tracks, use percentile approach
    // Take bottom third of all candidates by difference (worst relative to baseline)
    const percentileFurther = candidatesWithDiff
      .sort((a, b) => a.diff - b.diff)
      .slice(0, Math.max(thirdSize, TARGET_PER_CATEGORY * 2))
      .filter((item) => !badCandidates.includes(item.metric))
      .slice(0, TARGET_PER_CATEGORY * 2 - badCandidates.length)
      .map((item) => item.metric)

    badCandidates.push(...percentileFurther)

    // Check quality after expansion
    const expandedFurtherQuality = calculateCategoryQuality(
      badCandidates,
      baseline,
      currentPlayerId
    )
    const qualityImproved =
      expandedFurtherQuality.qualityScore > furtherQuality.qualityScore

    logger(
      'INFO',
      `Expanded further category: ${badCandidates.length} candidates (added ${percentileFurther.length} via percentile). Quality: ${expandedFurtherQuality.qualityScore.toFixed(3)} (${qualityImproved ? 'improved' : 'degraded'})`,
      'applyDiversityConstraints'
    )
  }

  // If neutral is still too small, use percentile approach
  if (neutralCandidates.length < TARGET_PER_CATEGORY) {
    // Check quality of current neutral candidates before expanding
    const neutralQuality = calculateCategoryQuality(
      neutralCandidates,
      baseline,
      currentPlayerId
    )
    const minQualityThreshold = MIN_QUALITY_THRESHOLDS.neutral

    if (neutralQuality.qualityScore < minQualityThreshold) {
      logger(
        'WARN',
        `Neutral category quality (${neutralQuality.qualityScore.toFixed(3)}) below threshold (${minQualityThreshold}). Current: delta=${neutralQuality.averageAttractionDelta.toFixed(3)}, diversity=${neutralQuality.diversityScore.toFixed(3)}, popularity=${neutralQuality.popularitySpread.toFixed(3)}, genres=${neutralQuality.genreVariety.toFixed(3)}`,
        'applyDiversityConstraints'
      )
    }

    const used = new Set([...goodCandidates, ...badCandidates])
    const remaining = candidatesWithDiff
      .filter((item) => !used.has(item.metric))
      .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff)) // Closest to baseline first
      .slice(0, Math.max(TARGET_PER_CATEGORY, thirdSize))
      .map((item) => item.metric)
    neutralCandidates = [...neutralCandidates, ...remaining].slice(0, thirdSize)

    // Check quality after expansion
    const expandedNeutralQuality = calculateCategoryQuality(
      neutralCandidates,
      baseline,
      currentPlayerId
    )
    const qualityImproved =
      expandedNeutralQuality.qualityScore > neutralQuality.qualityScore

    logger(
      'INFO',
      `Expanded neutral category: ${neutralCandidates.length} candidates. Quality: ${expandedNeutralQuality.qualityScore.toFixed(3)} (${qualityImproved ? 'improved' : 'degraded'})`,
      'applyDiversityConstraints'
    )
  }

  // Log attraction distribution for diagnostics
  const attractionScores = candidatesWithDiff.map((item) => item.attraction)
  const attractionStats =
    attractionScores.length > 0
      ? {
          min: Math.min(...attractionScores),
          max: Math.max(...attractionScores),
          avg:
            attractionScores.reduce((a, b) => a + b, 0) /
            attractionScores.length,
          median: attractionScores.sort((a, b) => a - b)[
            Math.floor(attractionScores.length / 2)
          ]
        }
      : { min: 0, max: 0, avg: 0, median: 0 }
  const diffStats = {
    min: minDiff,
    max: maxDiff,
    avg:
      candidatesWithDiff.reduce((sum, item) => sum + item.diff, 0) /
      candidatesWithDiff.length
  }

  // Check if all differences are on one side (all positive or all negative)
  // This requires percentile-based redistribution to create a balanced mix
  const allNegative = maxDiff <= 0 // All differences are negative (all "further")
  const allPositive = minDiff > 0 // All differences are positive (all "closer") - needs percentile split

  logger(
    'INFO',
    `Attraction distribution (baseline=${baseline.toFixed(3)}, total=${totalCandidates}): ` +
      `Attraction: min=${attractionStats.min.toFixed(3)}, max=${attractionStats.max.toFixed(3)}, avg=${attractionStats.avg.toFixed(3)}, median=${attractionStats.median.toFixed(3)} | ` +
      `Diff: min=${diffStats.min.toFixed(3)}, max=${diffStats.max.toFixed(3)}, avg=${diffStats.avg.toFixed(3)}, range=${diffRange.toFixed(3)}${allNegative ? ' | ⚠️ ALL NEGATIVE (no genuine closer options)' : ''}${allPositive ? ' | ⚠️ ALL POSITIVE (no genuine further options)' : ''}`,
    'applyDiversityConstraints'
  )

  logger(
    'INFO',
    `Strategic categories for Player ${currentPlayerId}: Closer=${goodCandidates.length} | Neutral=${neutralCandidates.length} | Further=${badCandidates.length}${allNegative || allPositive ? ' (using percentile-based relative categorization)' : ''}`,
    'applyDiversityConstraints'
  )

  // Define similarity tiers for diversity within each category
  const SIMILARITY_TIERS = {
    low: { min: 0, max: 0.4, label: 'low' as const },
    medium: { min: 0.4, max: 0.7, label: 'medium' as const },
    high: { min: 0.7, max: 1.0, label: 'high' as const }
  }

  // Track artist names separately for name-based duplicate detection
  const artistNames = new Set<string>()

  // Helper function to check if an artist is already selected
  const isArtistSelected = (metric: CandidateTrackMetrics): boolean => {
    const trackArtistIds = new Set<string>()
    const trackArtistNames = new Set<string>()

    // Add primary artist ID
    const primaryArtistId = metric.artistId ?? metric.track.artists?.[0]?.id
    if (primaryArtistId) {
      trackArtistIds.add(primaryArtistId)
    }

    // Add all artist IDs and names from the track
    if (metric.track.artists && Array.isArray(metric.track.artists)) {
      for (const artist of metric.track.artists) {
        if (artist.id) {
          trackArtistIds.add(artist.id)
        }
        if (artist.name) {
          trackArtistNames.add(artist.name.toLowerCase().trim())
        }
      }
    }

    // Also add metric's artistName for comparison
    if (metric.artistName) {
      trackArtistNames.add(metric.artistName.toLowerCase().trim())
      // If no IDs, use name as fallback identifier
      if (trackArtistIds.size === 0) {
        trackArtistIds.add(metric.artistName.toLowerCase().trim())
      }
    }

    // Final fallback to track ID if nothing else is available
    if (trackArtistIds.size === 0 && trackArtistNames.size === 0) {
      trackArtistIds.add(metric.track.id)
    }

    // Check if ANY of this track's artists have already been selected
    const hasOverlappingArtistId = Array.from(trackArtistIds).some((id) =>
      artistIds.has(id)
    )
    const hasOverlappingArtistName = Array.from(trackArtistNames).some((name) =>
      artistNames.has(name)
    )

    return hasOverlappingArtistId || hasOverlappingArtistName
  }

  // Helper function to add an artist to the selected list
  const addToSelected = (metric: CandidateTrackMetrics): void => {
    selected.push(metric)

    // Track all artist IDs and names from this track
    const trackArtistIds = new Set<string>()
    const trackArtistNames = new Set<string>()

    const primaryArtistId = metric.artistId ?? metric.track.artists?.[0]?.id
    if (primaryArtistId) {
      trackArtistIds.add(primaryArtistId)
    }

    if (metric.track.artists && Array.isArray(metric.track.artists)) {
      for (const artist of metric.track.artists) {
        if (artist.id) {
          trackArtistIds.add(artist.id)
        }
        if (artist.name) {
          trackArtistNames.add(artist.name.toLowerCase().trim())
        }
      }
    }

    if (metric.artistName) {
      trackArtistNames.add(metric.artistName.toLowerCase().trim())
      if (trackArtistIds.size === 0) {
        trackArtistIds.add(metric.artistName.toLowerCase().trim())
      }
    }

    if (trackArtistIds.size === 0 && trackArtistNames.size === 0) {
      trackArtistIds.add(metric.track.id)
    }

    // Add all artist IDs and names to prevent future overlaps
    trackArtistIds.forEach((id) => artistIds.add(id))
    trackArtistNames.forEach((name) => artistNames.add(name))
  }

  // Select balanced tracks using weighted allocation instead of round-robin
  function selectBalancedTracks(
    categories: {
      closer: CandidateTrackMetrics[]
      neutral: CandidateTrackMetrics[]
      further: CandidateTrackMetrics[]
    },
    targetCount: number = 9
  ): CandidateTrackMetrics[] {
    const selected: CandidateTrackMetrics[] = []
    const categoryCounts = { closer: 0, neutral: 0, further: 0 }

    logger(
      'INFO',
      `Starting weighted selection. Target: ${targetCount} tracks`,
      'selectBalancedTracks'
    )

    // Phase 1: Guarantee minimums for each category using best quality tracks
    const categoryKeys: (keyof typeof categories)[] = [
      'closer',
      'neutral',
      'further'
    ]

    for (const categoryKey of categoryKeys) {
      const guaranteed = GUARANTEED_MINIMUMS[categoryKey]
      const candidates = categories[categoryKey]

      // Sort by quality (use a simple heuristic if no quality scores available)
      const sortedCandidates = candidates.sort((a, b) => {
        // Use final score as quality proxy for now
        return b.finalScore - a.finalScore
      })

      for (const candidate of sortedCandidates.slice(0, guaranteed)) {
        if (!isArtistSelected(candidate)) {
          candidate.selectionCategory = categoryKey
          addToSelected(candidate)
          selected.push(candidate)
          categoryCounts[categoryKey]++
          logger(
            'INFO',
            `  Phase 1: Selected ${categoryKey} track (${categoryCounts[categoryKey]}/${guaranteed} min): ${candidate.artistName} | Score=${candidate.finalScore.toFixed(3)}`,
            'selectBalancedTracks'
          )
        }
      }
    }

    logger(
      'INFO',
      `Phase 1 complete: Closer=${categoryCounts.closer}/${GUARANTEED_MINIMUMS.closer} | Neutral=${categoryCounts.neutral}/${GUARANTEED_MINIMUMS.neutral} | Further=${categoryCounts.further}/${GUARANTEED_MINIMUMS.further} | Total=${selected.length}`,
      'selectBalancedTracks'
    )

    // Phase 2: Fill remaining slots using weighted selection
    while (selected.length < targetCount) {
      const remainingSlots = targetCount - selected.length

      // Calculate available candidates per category
      const availableCounts = {
        closer: categories.closer.filter((c) => !isArtistSelected(c)).length,
        neutral: categories.neutral.filter((c) => !isArtistSelected(c)).length,
        further: categories.further.filter((c) => !isArtistSelected(c)).length
      }

      // Skip categories that have reached their maximum (3 total) or have no candidates
      const eligibleCategories = categoryKeys.filter(
        (key) => categoryCounts[key] < 3 && availableCounts[key] > 0
      )

      if (eligibleCategories.length === 0) {
        logger(
          'WARN',
          `No eligible categories remaining. Stopping at ${selected.length}/${targetCount} tracks`,
          'selectBalancedTracks'
        )
        break
      }

      // Select category using weighted probabilities
      let selectedCategory: keyof typeof categories | null = null
      const random = Math.random()
      let cumulativeWeight = 0

      for (const category of eligibleCategories) {
        cumulativeWeight += CATEGORY_WEIGHTS[category]
        if (random <= cumulativeWeight) {
          selectedCategory = category
          break
        }
      }

      // Fallback to first eligible category if weights didn't select one
      if (!selectedCategory) {
        selectedCategory = eligibleCategories[0]
      }

      // Select best available candidate from chosen category
      const candidates = categories[selectedCategory].filter(
        (c) => !isArtistSelected(c)
      )
      if (candidates.length === 0) {
        logger(
          'WARN',
          `No candidates available in ${selectedCategory} category`,
          'selectBalancedTracks'
        )
        continue
      }

      // Sort by quality and select the best
      const bestCandidate = candidates.sort(
        (a, b) => b.finalScore - a.finalScore
      )[0]
      bestCandidate.selectionCategory = selectedCategory
      addToSelected(bestCandidate)
      selected.push(bestCandidate)
      categoryCounts[selectedCategory]++

      logger(
        'INFO',
        `  Phase 2: Selected ${selectedCategory} track (${categoryCounts[selectedCategory]}/3): ${bestCandidate.artistName} | Score=${bestCandidate.finalScore.toFixed(3)} | Remaining slots: ${remainingSlots - 1}`,
        'selectBalancedTracks'
      )
    }

    logger(
      'INFO',
      `Weighted selection complete: Closer=${categoryCounts.closer} | Neutral=${categoryCounts.neutral} | Further=${categoryCounts.further} | Total=${selected.length}/${targetCount}`,
      'selectBalancedTracks'
    )

    return selected
  }

  // Step 1: Select balanced tracks using weighted allocation
  const categoryCandidates = {
    closer: goodCandidates,
    neutral: neutralCandidates,
    further: badCandidates
  }

  const balancedSelection = selectBalancedTracks(
    categoryCandidates,
    DISPLAY_OPTION_COUNT
  )

  // Split back into category arrays for compatibility with existing code
  const closerSelected = balancedSelection.filter(
    (c) => c.selectionCategory === 'closer'
  )
  const neutralSelected = balancedSelection.filter(
    (c) => c.selectionCategory === 'neutral'
  )
  const furtherSelected = balancedSelection.filter(
    (c) => c.selectionCategory === 'further'
  )

  // Log final distribution
  const achievedBalance =
    closerSelected.length === TRACKS_PER_CATEGORY &&
    neutralSelected.length === TRACKS_PER_CATEGORY &&
    furtherSelected.length === TRACKS_PER_CATEGORY
  const balanceStatus = achievedBalance ? '✅ ACHIEVED' : '⚠️ PARTIAL'

  logger(
    'INFO',
    `Round-robin selection complete (${balanceStatus}): Closer=${closerSelected.length}/${TRACKS_PER_CATEGORY} | Neutral=${neutralSelected.length}/${TRACKS_PER_CATEGORY} | Further=${furtherSelected.length}/${TRACKS_PER_CATEGORY}`,
    'applyDiversityConstraints'
  )

  // Step 2: Handle insufficient tracks - try to maintain 3-3-3 distribution
  const totalSelected =
    closerSelected.length + neutralSelected.length + furtherSelected.length

  if (totalSelected < DISPLAY_OPTION_COUNT) {
    logger(
      'WARN',
      `Insufficient tracks after round-robin: Closer=${closerSelected.length} | Neutral=${neutralSelected.length} | Further=${furtherSelected.length} (need ${DISPLAY_OPTION_COUNT})`,
      'applyDiversityConstraints'
    )

    // Try to fill missing slots while maintaining 3-3-3 balance
    // Only fill categories that are below 3, never exceed 3
    // Define categories structure for filling logic
    const allCategories = [
      { label: 'Closer', candidates: goodCandidates, selected: closerSelected },
      {
        label: 'Neutral',
        candidates: neutralCandidates,
        selected: neutralSelected
      },
      { label: 'Further', candidates: badCandidates, selected: furtherSelected }
    ]

    const categoryNeeds = [
      {
        category: allCategories[0],
        needed: Math.max(0, TRACKS_PER_CATEGORY - closerSelected.length)
      },
      {
        category: allCategories[1],
        needed: Math.max(0, TRACKS_PER_CATEGORY - neutralSelected.length)
      },
      {
        category: allCategories[2],
        needed: Math.max(0, TRACKS_PER_CATEGORY - furtherSelected.length)
      }
    ]
      .filter((c) => c.needed > 0)
      .sort((a, b) => b.needed - a.needed) // Fill most-needed first

    for (const { category, needed } of categoryNeeds) {
      let filled = 0
      for (const candidate of category.candidates) {
        // Stop if we've filled this category to exactly 3
        if (category.selected.length >= TRACKS_PER_CATEGORY) break
        if (filled >= needed) break
        if (!isArtistSelected(candidate)) {
          candidate.selectionCategory = category.label.toLowerCase() as
            | 'closer'
            | 'neutral'
            | 'further'
          addToSelected(candidate)
          category.selected.push(candidate)
          filled++
          logger(
            'INFO',
            `  Filled ${category.label} slot (${category.selected.length}/${TRACKS_PER_CATEGORY}): ${candidate.artistName} | Sim=${candidate.simScore.toFixed(3)}`,
            'applyDiversityConstraints'
          )
        }
      }
    }

    // Final check - if still not enough, try to maintain balance
    // Only add to categories that are below 3, never exceed 3
    const stillNeeded = DISPLAY_OPTION_COUNT - selected.length
    if (stillNeeded > 0) {
      logger(
        'WARN',
        `Still need ${stillNeeded} more tracks. Attempting balanced fill...`,
        'applyDiversityConstraints'
      )

      // Try to fill remaining slots while maintaining 3-3-3 balance
      // Distribute remaining needs across categories that are below 3
      const remainingNeeds = categoryNeeds.filter((c) => c.needed > 0)
      if (remainingNeeds.length > 0) {
        // Distribute evenly across categories that need more
        const perCategory = Math.ceil(stillNeeded / remainingNeeds.length)
        for (const { category, needed } of remainingNeeds) {
          const toFill = Math.min(
            perCategory,
            needed,
            stillNeeded - (DISPLAY_OPTION_COUNT - selected.length)
          )
          if (toFill <= 0) continue

          let filled = 0
          for (const candidate of category.candidates) {
            if (category.selected.length >= TRACKS_PER_CATEGORY) break
            if (filled >= toFill) break
            if (!isArtistSelected(candidate)) {
              candidate.selectionCategory = category.label.toLowerCase() as
                | 'closer'
                | 'neutral'
                | 'further'
              addToSelected(candidate)
              category.selected.push(candidate)
              filled++
              logger(
                'INFO',
                `  Final balanced fill ${category.label} (${category.selected.length}/${TRACKS_PER_CATEGORY}): ${candidate.artistName}`,
                'applyDiversityConstraints'
              )
            }
          }
        }
      }

      // If we still don't have 9, fill from any remaining (shouldn't happen if logic is correct)
      const finalNeeded = DISPLAY_OPTION_COUNT - selected.length
      if (finalNeeded > 0) {
        logger(
          'ERROR',
          `CRITICAL: Still need ${finalNeeded} tracks after all fill attempts. This should not happen.`,
          'applyDiversityConstraints'
        )
        const allRemaining = sortedFilteredMetrics.filter(
          (m) => !isArtistSelected(m)
        )
        for (const candidate of allRemaining.slice(0, finalNeeded)) {
          // Determine best-fit category
          const diff =
            getCurrentPlayerAttraction(candidate) -
            candidate.currentSongAttraction

          if (allPositive || allNegative) {
            // If distribution is skewed (forced percentile), late additions are effectively 'neutral'
            // relative to the enforced extremes.
            candidate.selectionCategory = 'neutral'
          } else {
            if (diff > NEUTRAL_TOLERANCE) candidate.selectionCategory = 'closer'
            else if (diff < -NEUTRAL_TOLERANCE)
              candidate.selectionCategory = 'further'
            else candidate.selectionCategory = 'neutral'
          }

          addToSelected(candidate)
        }
      }
    }
  }

  logger(
    'INFO',
    `Strategic distribution: Closer=${closerSelected.length} | Neutral=${neutralSelected.length} | Further=${furtherSelected.length} | Total=${selected.length}`,
    'applyDiversityConstraints'
  )

  // Log final selection summary
  logger(
    'INFO',
    `Selection complete: ${selected.length} options from ${sortedFilteredMetrics.length} candidates`,
    'applyDiversityConstraints'
  )

  // Log each selected track with its category and metrics
  selected.forEach((metric, index) => {
    const artistList =
      metric.track.artists?.map((a) => a.name).join(', ') ??
      metric.artistName ??
      'Unknown'

    // Determine category for this track based on comparison to baseline
    const currentPlayerAttraction = getCurrentPlayerAttraction(metric)
    const baseline = metric.currentSongAttraction
    const diff = currentPlayerAttraction - baseline
    let category = 'NEUTRAL'
    if (diff > NEUTRAL_TOLERANCE) {
      category = 'CLOSER'
    } else if (diff < -NEUTRAL_TOLERANCE) {
      category = 'FURTHER'
    }

    logger(
      'INFO',
      `  Option ${index + 1} [${category}]: "${metric.track.name}" by ${artistList} | Sim=${metric.simScore.toFixed(3)} | Attraction=${currentPlayerAttraction.toFixed(3)} vs Baseline=${metric.currentSongAttraction.toFixed(3)}`,
      'applyDiversityConstraints'
    )
  })

  // Log similarity tier distribution in final selection
  const tierDistribution = {
    low: selected.filter((m) => m.simScore < 0.4).length,
    medium: selected.filter((m) => m.simScore >= 0.4 && m.simScore < 0.7)
      .length,
    high: selected.filter((m) => m.simScore >= 0.7).length
  }

  logger(
    'INFO',
    `Similarity tier distribution: Low (<0.4)=${tierDistribution.low} | Medium (0.4-0.7)=${tierDistribution.medium} | High (>0.7)=${tierDistribution.high}`,
    'applyDiversityConstraints'
  )

  // Log strategic distribution in final selection
  let finalCloser = 0
  let finalNeutral = 0
  let finalFurther = 0

  selected.forEach((metric) => {
    const currentPlayerAttraction = getCurrentPlayerAttraction(metric)
    const baseline = metric.currentSongAttraction
    const diff = currentPlayerAttraction - baseline
    if (diff > NEUTRAL_TOLERANCE) {
      finalCloser++
    } else if (diff < -NEUTRAL_TOLERANCE) {
      finalFurther++
    } else {
      finalNeutral++
    }
  })

  logger(
    'INFO',
    `Final strategic distribution for Player ${currentPlayerId}: Closer=${finalCloser} | Neutral=${finalNeutral} | Further=${finalFurther}`,
    'applyDiversityConstraints'
  )

  // CRITICAL FIX: Recalculate selectionCategory for all selected tracks using NEUTRAL_TOLERANCE
  // This ensures categories match requirements regardless of adaptiveTolerance used during selection
  selected.forEach((metric) => {
    const currentPlayerAttraction = getCurrentPlayerAttraction(metric)
    const baseline = metric.currentSongAttraction
    const diff = currentPlayerAttraction - baseline
    
    // Use NEUTRAL_TOLERANCE (0.02) as per requirements_scoring_logic.md Section 5.1
    if (diff > NEUTRAL_TOLERANCE) {
      metric.selectionCategory = 'closer'
    } else if (diff < -NEUTRAL_TOLERANCE) {
      metric.selectionCategory = 'further'
    } else {
      metric.selectionCategory = 'neutral'
    }
  })

  // Rebuild category arrays after recalculating categories to ensure correct 3-3-3 distribution
  const recategorizedCloser = selected.filter((m) => m.selectionCategory === 'closer')
  const recategorizedNeutral = selected.filter((m) => m.selectionCategory === 'neutral')
  const recategorizedFurther = selected.filter((m) => m.selectionCategory === 'further')

  // Ensure we have exactly 3 of each category, prioritizing by finalScore
  const finalSelected: CandidateTrackMetrics[] = []
  
  // Sort each category by finalScore (best first) and take top 3
  const sortedCloser = [...recategorizedCloser].sort((a, b) => b.finalScore - a.finalScore)
  const sortedNeutral = [...recategorizedNeutral].sort((a, b) => b.finalScore - a.finalScore)
  const sortedFurther = [...recategorizedFurther].sort((a, b) => b.finalScore - a.finalScore)
  
  finalSelected.push(...sortedCloser.slice(0, TRACKS_PER_CATEGORY))
  finalSelected.push(...sortedNeutral.slice(0, TRACKS_PER_CATEGORY))
  finalSelected.push(...sortedFurther.slice(0, TRACKS_PER_CATEGORY))

  // If we still don't have 9, fill from remaining candidates sorted by finalScore
  if (finalSelected.length < DISPLAY_OPTION_COUNT) {
    const usedIds = new Set(finalSelected.map((m) => m.track.id))
    const remaining = sortedFilteredMetrics
      .filter((m) => !usedIds.has(m.track.id))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, DISPLAY_OPTION_COUNT - finalSelected.length)
    
    // Recalculate category for remaining tracks
    remaining.forEach((metric) => {
      const currentPlayerAttraction = getCurrentPlayerAttraction(metric)
      const baseline = metric.currentSongAttraction
      const diff = currentPlayerAttraction - baseline
      
      if (diff > NEUTRAL_TOLERANCE) {
        metric.selectionCategory = 'closer'
      } else if (diff < -NEUTRAL_TOLERANCE) {
        metric.selectionCategory = 'further'
      } else {
        metric.selectionCategory = 'neutral'
      }
    })
    
    finalSelected.push(...remaining)
  }

  logger(
    'INFO',
    `Final return after category correction: Closer=${finalSelected.filter((m) => m.selectionCategory === 'closer').length} | Neutral=${finalSelected.filter((m) => m.selectionCategory === 'neutral').length} | Further=${finalSelected.filter((m) => m.selectionCategory === 'further').length} | Total=${finalSelected.length}`,
    'applyDiversityConstraints'
  )

  // Validate diversity: verify we achieved 3-3-3 distribution
  const actualCloser = finalSelected.filter((m) => m.selectionCategory === 'closer').length
  const actualNeutral = finalSelected.filter((m) => m.selectionCategory === 'neutral').length
  const actualFurther = finalSelected.filter((m) => m.selectionCategory === 'further').length
  const achievedPerfectBalance =
    actualCloser === TRACKS_PER_CATEGORY &&
    actualNeutral === TRACKS_PER_CATEGORY &&
    actualFurther === TRACKS_PER_CATEGORY

  // Validation: Check that categories match mathematical differences (REQ-FUN compliance)
  const categorizationErrors: string[] = []
  finalSelected.forEach((metric, index) => {
    const currentPlayerAttraction = getCurrentPlayerAttraction(metric)
    const baseline = metric.currentSongAttraction
    const diff = currentPlayerAttraction - baseline
    const expectedCategory = 
      diff > NEUTRAL_TOLERANCE ? 'closer' :
      diff < -NEUTRAL_TOLERANCE ? 'further' : 'neutral'
    
    if (metric.selectionCategory !== expectedCategory) {
      categorizationErrors.push(
        `Option ${index + 1} (${metric.track.name}): Expected ${expectedCategory} (diff=${diff.toFixed(3)}), got ${metric.selectionCategory}`
      )
    }
  })

  if (categorizationErrors.length > 0) {
    logger(
      'ERROR',
      `Categorization validation failed! ${categorizationErrors.length} tracks have incorrect categories:\n${categorizationErrors.join('\n')}`,
      'applyDiversityConstraints'
    )
  }

  if (!achievedPerfectBalance) {
    logger(
      'WARN',
      `Diversity validation: Did not achieve perfect 3-3-3 balance. Actual: Closer=${actualCloser} | Neutral=${actualNeutral} | Further=${actualFurther}. ` +
        `Total candidates: ${sortedFilteredMetrics.length}. ` +
        `This may indicate insufficient diversity in candidate pool.`,
      'applyDiversityConstraints'
    )
  } else {
    logger(
      'INFO',
      `Diversity validation: Successfully achieved 3-3-3 balance after category correction. All ${finalSelected.length} tracks correctly categorized.`,
      'applyDiversityConstraints'
    )
  }

  return {
    selected: finalSelected.map((metric) => ({
      ...metric
    })),
    filteredArtistNames
  }
}
