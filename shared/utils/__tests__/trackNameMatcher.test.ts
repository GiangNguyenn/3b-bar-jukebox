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

void describe('normalizeTrackName', () => {
  void it('converts to lowercase', () => {
    assert.equal(normalizeTrackName('BOHEMIAN RHAPSODY'), 'bohemian rhapsody')
  })

  void it('strips parenthetical feat. suffix', () => {
    assert.equal(normalizeTrackName('Dirrty (feat. Redman)'), 'dirrty')
  })

  void it('strips parenthetical Remastered suffix', () => {
    assert.equal(
      normalizeTrackName("Don't Stop Me Now (2011 Remaster)"),
      "don't stop me now"
    )
  })

  void it('strips parenthetical Deluxe Edition suffix', () => {
    assert.equal(
      normalizeTrackName('Song Title (Deluxe Edition)'),
      'song title'
    )
  })

  void it('strips parenthetical Live suffix', () => {
    assert.equal(normalizeTrackName('Song Title (Live)'), 'song title')
  })

  void it('strips dash remastered suffix', () => {
    assert.equal(
      normalizeTrackName('Bohemian Rhapsody - Remastered 2011'),
      'bohemian rhapsody'
    )
  })

  void it('strips dash deluxe suffix', () => {
    assert.equal(normalizeTrackName('Song Title - Deluxe'), 'song title')
  })

  void it('strips year-prefixed dash remaster suffix', () => {
    assert.equal(normalizeTrackName('Queer - 2015 Remaster'), 'queer')
  })

  void it('strips multiple parenthetical suffixes', () => {
    assert.equal(normalizeTrackName('Song (feat. Artist) (Remastered)'), 'song')
  })

  void it('trims whitespace', () => {
    assert.equal(normalizeTrackName('  Song Title  '), 'song title')
  })

  void it('returns plain name unchanged (after lowercasing)', () => {
    assert.equal(normalizeTrackName('Simple Song'), 'simple song')
  })
})

void describe('fuzzyTrackNameMatch', () => {
  void it('matches identical names', () => {
    assert.equal(fuzzyTrackNameMatch('Dirrty', 'Dirrty'), true)
  })

  void it('matches case-insensitive names', () => {
    assert.equal(fuzzyTrackNameMatch('dirrty', 'DIRRTY'), true)
  })

  void it('matches when Spotify adds feat. suffix', () => {
    assert.equal(fuzzyTrackNameMatch('Dirrty', 'Dirrty (feat. Redman)'), true)
  })

  void it('matches when Spotify adds remastered dash suffix', () => {
    assert.equal(
      fuzzyTrackNameMatch(
        'Bohemian Rhapsody',
        'Bohemian Rhapsody - Remastered 2011'
      ),
      true
    )
  })

  void it('matches when queue has year-prefixed remaster suffix', () => {
    assert.equal(fuzzyTrackNameMatch('Queer - 2015 Remaster', 'Queer'), true)
  })

  void it('matches when Spotify adds remastered parenthetical suffix', () => {
    assert.equal(
      fuzzyTrackNameMatch(
        "Don't Stop Me Now",
        "Don't Stop Me Now (2011 Remaster)"
      ),
      true
    )
  })

  void it('matches when queue has suffix and Spotify does not', () => {
    assert.equal(fuzzyTrackNameMatch('Dirrty (feat. Redman)', 'Dirrty'), true)
  })

  void it('returns false for genuinely different tracks', () => {
    assert.equal(
      fuzzyTrackNameMatch('Bohemian Rhapsody', 'We Will Rock You'),
      false
    )
  })

  void it('returns false for partially similar but different tracks', () => {
    assert.equal(fuzzyTrackNameMatch('Love Story', 'Love Story Part 2'), false)
  })

  void it('matches with mixed case and suffixes', () => {
    assert.equal(
      fuzzyTrackNameMatch(
        'BOHEMIAN RHAPSODY',
        'bohemian rhapsody (Remastered 2011)'
      ),
      true
    )
  })
})
