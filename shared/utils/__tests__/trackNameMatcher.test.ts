/**
 * Unit tests for trackNameMatcher utility
 *
 * **Validates: Requirements 2.1**
 *
 * Tests normalizeTrackName and fuzzyTrackNameMatch for:
 * - Parenthetical suffix stripping (feat., Remastered, Deluxe Edition, Live)
 * - Dash suffix stripping (- Remastered, - Deluxe Edition)
 * - Case insensitivity
 * - Genuine mismatches returning false
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTrackName, fuzzyTrackNameMatch } from '../trackNameMatcher'

describe('normalizeTrackName', () => {
  it('converts to lowercase', () => {
    assert.equal(normalizeTrackName('BOHEMIAN RHAPSODY'), 'bohemian rhapsody')
  })

  it('strips parenthetical feat. suffix', () => {
    assert.equal(normalizeTrackName('Dirrty (feat. Redman)'), 'dirrty')
  })

  it('strips parenthetical Remastered suffix', () => {
    assert.equal(
      normalizeTrackName("Don't Stop Me Now (2011 Remaster)"),
      "don't stop me now"
    )
  })

  it('strips parenthetical Deluxe Edition suffix', () => {
    assert.equal(
      normalizeTrackName('Song Title (Deluxe Edition)'),
      'song title'
    )
  })

  it('strips parenthetical Live suffix', () => {
    assert.equal(normalizeTrackName('Song Title (Live)'), 'song title')
  })

  it('strips dash remastered suffix', () => {
    assert.equal(
      normalizeTrackName('Bohemian Rhapsody - Remastered 2011'),
      'bohemian rhapsody'
    )
  })

  it('strips dash deluxe suffix', () => {
    assert.equal(normalizeTrackName('Song Title - Deluxe'), 'song title')
  })

  it('strips multiple parenthetical suffixes', () => {
    assert.equal(normalizeTrackName('Song (feat. Artist) (Remastered)'), 'song')
  })

  it('trims whitespace', () => {
    assert.equal(normalizeTrackName('  Song Title  '), 'song title')
  })

  it('returns plain name unchanged (after lowercasing)', () => {
    assert.equal(normalizeTrackName('Simple Song'), 'simple song')
  })
})

describe('fuzzyTrackNameMatch', () => {
  it('matches identical names', () => {
    assert.equal(fuzzyTrackNameMatch('Dirrty', 'Dirrty'), true)
  })

  it('matches case-insensitive names', () => {
    assert.equal(fuzzyTrackNameMatch('dirrty', 'DIRRTY'), true)
  })

  it('matches when Spotify adds feat. suffix', () => {
    assert.equal(fuzzyTrackNameMatch('Dirrty', 'Dirrty (feat. Redman)'), true)
  })

  it('matches when Spotify adds remastered dash suffix', () => {
    assert.equal(
      fuzzyTrackNameMatch(
        'Bohemian Rhapsody',
        'Bohemian Rhapsody - Remastered 2011'
      ),
      true
    )
  })

  it('matches when Spotify adds remastered parenthetical suffix', () => {
    assert.equal(
      fuzzyTrackNameMatch(
        "Don't Stop Me Now",
        "Don't Stop Me Now (2011 Remaster)"
      ),
      true
    )
  })

  it('matches when queue has suffix and Spotify does not', () => {
    assert.equal(fuzzyTrackNameMatch('Dirrty (feat. Redman)', 'Dirrty'), true)
  })

  it('returns false for genuinely different tracks', () => {
    assert.equal(
      fuzzyTrackNameMatch('Bohemian Rhapsody', 'We Will Rock You'),
      false
    )
  })

  it('returns false for partially similar but different tracks', () => {
    assert.equal(fuzzyTrackNameMatch('Love Story', 'Love Story Part 2'), false)
  })

  it('matches with mixed case and suffixes', () => {
    assert.equal(
      fuzzyTrackNameMatch(
        'BOHEMIAN RHAPSODY',
        'bohemian rhapsody (Remastered 2011)'
      ),
      true
    )
  })
})
