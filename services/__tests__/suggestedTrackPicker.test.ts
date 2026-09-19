import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RECENCY_HALF_LIFE_DAYS,
  pickWeightedSuggestedTrack,
  suggestedTrackWeight
} from '@/services/suggestedTrackPicker'

const NOW = Date.parse('2026-09-19T12:00:00Z')
const daysAgo = (days: number): string =>
  new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

void describe('suggestedTrackWeight', () => {
  void it('is higher for tracks suggested more often', () => {
    const once = suggestedTrackWeight(1, daysAgo(5), NOW)
    const often = suggestedTrackWeight(7, daysAgo(5), NOW)
    assert.ok(often > once)
  })

  void it('grows sub-linearly with count', () => {
    const once = suggestedTrackWeight(1, daysAgo(0), NOW)
    const seven = suggestedTrackWeight(7, daysAgo(0), NOW)
    assert.ok(seven < once * 7)
  })

  void it('is higher for more recent suggestions', () => {
    const recent = suggestedTrackWeight(1, daysAgo(1), NOW)
    const old = suggestedTrackWeight(1, daysAgo(90), NOW)
    assert.ok(recent > old)
  })

  void it('halves the recency component every half-life (above the floor)', () => {
    const fresh = suggestedTrackWeight(1, daysAgo(0), NOW)
    const aged = suggestedTrackWeight(1, daysAgo(RECENCY_HALF_LIFE_DAYS), NOW)
    // recency = 0.1 + 0.9 * decay; fresh = 1.0, one half-life = 0.55
    assert.ok(Math.abs(aged / fresh - 0.55) < 1e-9)
  })

  void it('stays strictly positive for very old, invalid or odd inputs', () => {
    for (const [count, at] of [
      [1, daysAgo(10000)],
      [0, daysAgo(1)],
      [-5, daysAgo(1)],
      [1, 'not-a-date'],
      [1, daysAgo(-3)] // future timestamp
    ] as Array<[number, string]>) {
      const w = suggestedTrackWeight(count, at, NOW)
      assert.ok(Number.isFinite(w) && w > 0, `weight for ${count}/${at} = ${w}`)
    }
  })
})

void describe('pickWeightedSuggestedTrack', () => {
  void it('returns null for an empty pool', () => {
    assert.equal(
      pickWeightedSuggestedTrack([], () => 0.5, NOW),
      null
    )
  })

  void it('returns the only candidate', () => {
    const track = { id: 'a' }
    const picked = pickWeightedSuggestedTrack(
      [{ track, count: 1, lastSuggestedAt: daysAgo(3) }],
      () => 0.999,
      NOW
    )
    assert.equal(picked, track)
  })

  void it('picks according to cumulative weight boundaries', () => {
    const heavy = { id: 'heavy' }
    const light = { id: 'light' }
    const candidates = [
      { track: heavy, count: 7, lastSuggestedAt: daysAgo(0) },
      { track: light, count: 1, lastSuggestedAt: daysAgo(365) }
    ]
    assert.equal(
      pickWeightedSuggestedTrack(candidates, () => 0, NOW),
      heavy
    )
    assert.equal(
      pickWeightedSuggestedTrack(candidates, () => 0.999999, NOW),
      light
    )
  })

  void it('favours frequent and recent tracks over many draws', () => {
    const hot = { id: 'hot' }
    const cold = { id: 'cold' }
    const candidates = [
      { track: hot, count: 5, lastSuggestedAt: daysAgo(1) },
      { track: cold, count: 1, lastSuggestedAt: daysAgo(120) }
    ]
    let hotPicks = 0
    let coldPicks = 0
    for (let i = 0; i < 2000; i++) {
      const picked = pickWeightedSuggestedTrack(candidates, Math.random, NOW)
      if (picked === hot) hotPicks++
      else coldPicks++
    }
    assert.ok(hotPicks > coldPicks * 3, `hot=${hotPicks} cold=${coldPicks}`)
    assert.ok(coldPicks > 0, 'the long tail must remain reachable')
  })
})
