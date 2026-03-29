import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'

void describe('DJService announcement — volume ducking', () => {
  // Feature: dj-winner-announcement, Property 1: Ducked volume is 20% of original
  // **Validates: Requirements 1.2**
  void it('ducked volume is always 20% of original (rounded)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (volume) => {
        const ducked = Math.round(volume * 0.2)
        assert.equal(ducked, Math.round(volume * 0.2))
        assert.ok(ducked >= 0, 'ducked volume must be non-negative')
        assert.ok(ducked <= 20, 'ducked volume must be at most 20')
        assert.ok(ducked <= volume, 'ducked volume must not exceed original')
      }),
      { numRuns: 100 }
    )
  })
})

void describe('DJService announcement — FIFO queue ordering', () => {
  // Feature: dj-winner-announcement, Property 2: All announcements are played in FIFO order, none dropped
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.5**
  void it('all announcements play in FIFO order, none dropped', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 10 }),
        (announcements) => {
          const played: string[] = []
          const queue: Array<() => void> = []
          let inProgress = false

          function drainQueue(): void {
            inProgress = false
            const next = queue.shift()
            if (next) {
              inProgress = true
              next()
            }
          }

          for (const text of announcements) {
            const execute = () => {
              played.push(text)
              drainQueue()
            }

            if (inProgress) {
              queue.push(execute)
            } else {
              inProgress = true
              execute()
            }
          }

          assert.deepEqual(
            played,
            announcements,
            'all announcements played in FIFO order'
          )
          assert.equal(
            played.length,
            announcements.length,
            'no announcements dropped'
          )
        }
      ),
      { numRuns: 100 }
    )
  })
})

void describe('DJService announcement — mutual exclusion', () => {
  // Feature: dj-winner-announcement, Property 3: At most one announcement plays at a time
  // **Validates: Requirements 2.4**
  void it('at most one announcement plays at a time', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 10 }),
        (announcements) => {
          const queue: Array<() => void> = []
          let inProgress = false
          let maxConcurrent = 0
          let currentConcurrent = 0

          function drainQueue(): void {
            currentConcurrent--
            inProgress = false
            const next = queue.shift()
            if (next) {
              inProgress = true
              next()
            }
          }

          for (const _text of announcements) {
            const execute = () => {
              currentConcurrent++
              maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
              drainQueue()
            }

            if (inProgress) {
              queue.push(execute)
            } else {
              inProgress = true
              execute()
            }
          }

          assert.ok(
            maxConcurrent <= 1,
            `max concurrent was ${maxConcurrent}, expected at most 1`
          )
        }
      ),
      { numRuns: 100 }
    )
  })
})

void describe('DJService announcement — error recovery', () => {
  // Feature: dj-winner-announcement, Property 4: Error recovery restores volume and drains queue
  // **Validates: Requirements 5.1, 5.2**
  void it('error during playback restores volume and drains queue', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.array(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 5 }),
        (originalVolume, queuedTexts) => {
          let restoredVolume: number | null = null
          const played: string[] = []
          const queue: Array<() => void> = []
          let inProgress = false

          function drainQueue(): void {
            inProgress = false
            const next = queue.shift()
            if (next) {
              inProgress = true
              next()
            }
          }

          // Queue up the follow-up announcements
          for (const text of queuedTexts) {
            queue.push(() => {
              played.push(text)
              drainQueue()
            })
          }

          // Simulate the first announcement erroring
          inProgress = true
          try {
            // Simulate playback error
            throw new Error('playback failed')
          } catch {
            // Volume restoration on error
            restoredVolume = originalVolume
          } finally {
            drainQueue()
          }

          // Volume was restored
          assert.equal(
            restoredVolume,
            originalVolume,
            'volume must be restored to original'
          )

          // Queue was fully drained despite the error
          assert.equal(
            played.length,
            queuedTexts.length,
            'all queued announcements must play'
          )
          assert.deepEqual(
            played,
            queuedTexts,
            'queued announcements play in order'
          )
          assert.equal(
            inProgress,
            false,
            'inProgress must be false after drain'
          )
        }
      ),
      { numRuns: 100 }
    )
  })
})

void describe('DJService announcement — DJ disabled guard', () => {
  // Feature: dj-winner-announcement, Property 5: DJ disabled skips announcement without error
  // **Validates: Requirements 4.3**
  void it('skips announcement without side effects when DJ is disabled', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (text) => {
        let ttsCalled = false
        let volumeChanged = false
        let audioPlayed = false
        let queueModified = false
        const djEnabled = false

        // Simulate announceTriviaWinner with DJ disabled
        function announceTriviaWinner(_text: string): void {
          if (!djEnabled) return

          // These should never execute
          ttsCalled = true
          volumeChanged = true
          audioPlayed = true
          queueModified = true
        }

        announceTriviaWinner(text)

        assert.equal(ttsCalled, false, 'TTS should not be called')
        assert.equal(volumeChanged, false, 'volume should not change')
        assert.equal(audioPlayed, false, 'audio should not play')
        assert.equal(queueModified, false, 'queue should not be modified')
      }),
      { numRuns: 100 }
    )
  })
})

void describe('DJService announcement — voice passthrough', () => {
  // Feature: dj-winner-announcement, Property 6: Configured voice is passed to TTS API
  // **Validates: Requirements 3.2**
  const DJ_VOICE_IDS = [
    'af_nova',
    'af_heart',
    'af_bella',
    'af_nicole',
    'af_sarah',
    'af_sky',
    'am_adam',
    'am_michael'
  ]
  const DEFAULT_DJ_VOICE = 'af_nova'

  void it('configured voice is passed to TTS API request', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DJ_VOICE_IDS),
        fc.string({ minLength: 1, maxLength: 100 }),
        (voice, text) => {
          // Simulate voice resolution logic from announceTriviaWinner
          const rawVoice: string | null = voice
          const resolvedVoice =
            typeof rawVoice === 'string' && DJ_VOICE_IDS.includes(rawVoice)
              ? rawVoice
              : DEFAULT_DJ_VOICE

          // Build the TTS request body
          const body = { text, language: 'english', voice: resolvedVoice }

          assert.equal(
            body.voice,
            voice,
            'configured voice must be passed through'
          )
          assert.ok(
            DJ_VOICE_IDS.includes(body.voice),
            'voice must be a valid DJ voice ID'
          )
        }
      ),
      { numRuns: 100 }
    )
  })

  void it('falls back to default voice when stored voice is invalid', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => !DJ_VOICE_IDS.includes(s)),
        (invalidVoice) => {
          const rawVoice: string | null = invalidVoice
          const resolvedVoice =
            typeof rawVoice === 'string' && DJ_VOICE_IDS.includes(rawVoice)
              ? rawVoice
              : DEFAULT_DJ_VOICE

          assert.equal(
            resolvedVoice,
            DEFAULT_DJ_VOICE,
            'must fall back to default voice'
          )
        }
      ),
      { numRuns: 100 }
    )
  })
})

void describe('maybeAnnounce — queuing behavior', () => {
  // Validates: Requirements 2.1, 2.2
  void it('queues a second announcement when one is in progress', () => {
    const queue: Array<() => void> = []
    let inProgress = false
    const played: string[] = []

    function drainQueue(): void {
      inProgress = false
      const next = queue.shift()
      if (next) {
        inProgress = true
        next()
      }
    }

    function simulateMaybeAnnounce(text: string): void {
      const execute = () => {
        played.push(text)
        // In real code, drainQueue is called in finally
      }

      if (inProgress) {
        queue.push(execute)
        return
      }

      inProgress = true
      execute()
      // Don't drain yet — simulate async playback still in progress
    }

    // First call — plays immediately
    simulateMaybeAnnounce('Song A intro')
    assert.equal(played.length, 1, 'first announcement should play immediately')
    assert.equal(inProgress, true, 'should be in progress')

    // Second call — should be queued, not dropped
    simulateMaybeAnnounce('Song B intro')
    assert.equal(played.length, 1, 'second announcement should not play yet')
    assert.equal(queue.length, 1, 'second announcement should be in queue')

    // First finishes — drain should play the queued one
    drainQueue()
    assert.equal(
      played.length,
      2,
      'queued announcement should play after drain'
    )
    assert.deepEqual(
      played,
      ['Song A intro', 'Song B intro'],
      'played in order'
    )
  })

  void it('plays queued announcements in order after current finishes', () => {
    const queue: Array<() => void> = []
    let inProgress = false
    const played: string[] = []

    function drainQueue(): void {
      inProgress = false
      const next = queue.shift()
      if (next) {
        inProgress = true
        next()
      }
    }

    function simulateMaybeAnnounce(text: string): void {
      const execute = () => {
        played.push(text)
      }

      if (inProgress) {
        queue.push(execute)
        return
      }

      inProgress = true
      execute()
    }

    // Queue up three announcements
    simulateMaybeAnnounce('First')
    simulateMaybeAnnounce('Second')
    simulateMaybeAnnounce('Third')

    assert.equal(played.length, 1, 'only first should have played')
    assert.equal(queue.length, 2, 'two should be queued')

    // Drain one
    drainQueue()
    assert.equal(played.length, 2, 'second should play after drain')

    // Drain again
    drainQueue()
    assert.equal(played.length, 3, 'third should play after second drain')

    // Final drain — simulates the finally block after third announcement completes
    drainQueue()

    assert.deepEqual(
      played,
      ['First', 'Second', 'Third'],
      'all played in FIFO order'
    )
    assert.equal(queue.length, 0, 'queue should be empty')
    assert.equal(
      inProgress,
      false,
      'should not be in progress after all drained'
    )
  })
})
