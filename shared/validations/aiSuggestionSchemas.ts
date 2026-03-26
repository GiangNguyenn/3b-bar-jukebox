import { z } from 'zod'

export const aiSuggestionsRequestSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt must not be empty')
    .max(500, 'Prompt must be 500 characters or fewer'),
  excludedTrackIds: z.array(z.string()),
  queuedTracks: z
    .array(
      z.object({
        title: z.string(),
        artist: z.string()
      })
    )
    .optional()
    .default([]),
  profileId: z.string().min(1, 'Profile ID must not be empty')
})
