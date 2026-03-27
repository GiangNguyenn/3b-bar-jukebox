import { z } from 'zod'

export const triviaQuestionRequestSchema = z.object({
  profile_id: z.string().uuid(),
  spotify_track_id: z.string().min(1),
  track_name: z.string().min(1),
  artist_name: z.string().min(1),
  album_name: z.string().min(1)
})

export const triviaQuestionResponseSchema = z.object({
  question: z.string().min(1),
  options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  correctIndex: z.number().int().min(0).max(3)
})

export const scoreSubmitRequestSchema = z.object({
  profile_id: z.string().uuid(),
  session_id: z.string().min(1),
  player_name: z.string().min(1).max(20)
})

export const resetRequestSchema = z.object({
  profile_id: z.string().uuid()
})

export type TriviaQuestionRequest = z.infer<typeof triviaQuestionRequestSchema>
export type TriviaQuestionResponse = z.infer<
  typeof triviaQuestionResponseSchema
>
export type ScoreSubmitRequest = z.infer<typeof scoreSubmitRequestSchema>
export type ResetRequest = z.infer<typeof resetRequestSchema>
