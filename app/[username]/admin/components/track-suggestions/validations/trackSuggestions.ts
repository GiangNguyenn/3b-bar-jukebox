import { z } from 'zod'

export const SONGS_BETWEEN_REPEATS_MIN = 2
export const SONGS_BETWEEN_REPEATS_MAX = 100
export const SONGS_BETWEEN_REPEATS_DEFAULT = 20

export const songsBetweenRepeatsSchema = z
  .number()
  .int('Songs between repeats must be an integer')
  .min(
    SONGS_BETWEEN_REPEATS_MIN,
    `Songs between repeats must be at least ${SONGS_BETWEEN_REPEATS_MIN}`
  )
  .max(
    SONGS_BETWEEN_REPEATS_MAX,
    `Songs between repeats cannot exceed ${SONGS_BETWEEN_REPEATS_MAX}`
  )
  .transform((val) => Math.floor(val)) // Ensure integer values

export function validateSongsBetweenRepeats(value: number): string | null {
  if (typeof value !== 'number') {
    return 'Songs between repeats must be a number'
  }
  if (!Number.isInteger(value)) {
    return 'Songs between repeats must be an integer'
  }
  if (value < SONGS_BETWEEN_REPEATS_MIN) {
    return `Songs between repeats must be at least ${SONGS_BETWEEN_REPEATS_MIN}`
  }
  if (value > SONGS_BETWEEN_REPEATS_MAX) {
    return `Songs between repeats cannot exceed ${SONGS_BETWEEN_REPEATS_MAX}`
  }
  return null
} 