import { z } from 'zod'
import type {
  TokenResponse,
  TokenErrorResponse,
  TokenHealthResponse
} from '@/shared/types/token'

/**
 * Zod schema for validating token response from API endpoints
 */
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1, 'Access token is required'),
  refresh_token: z.string().optional(),
  expires_in: z
    .number()
    .int()
    .positive('Expires in must be a positive integer'),
  token_type: z.string().optional(),
  scope: z.string().optional()
})

/**
 * Zod schema for token response with expires_at timestamp
 */
export const TokenResponseWithExpirySchema = TokenResponseSchema.extend({
  expires_at: z.number().int().positive('Expires at must be a positive integer')
})

/**
 * Zod schema for validating error responses from token API endpoints
 */
export const TokenErrorResponseSchema = z.object({
  error: z.string().min(1, 'Error message is required'),
  code: z.string().optional(),
  status: z.number().int().optional()
})

/**
 * Zod schema for validating health check responses
 * More lenient as it may include partial data
 */
export const TokenHealthResponseSchema = z.object({
  access_token: z.string().optional(),
  expiresIn: z.number().int().positive().optional(),
  expires_in: z.number().int().positive().optional(),
  expires_at: z.number().int().positive().optional()
})

/**
 * Type-safe parsers that throw on validation failure
 */
export function parseTokenResponse(data: unknown): TokenResponse {
  return TokenResponseSchema.parse(data)
}

export function parseTokenErrorResponse(data: unknown): TokenErrorResponse {
  return TokenErrorResponseSchema.parse(data)
}

export function parseTokenHealthResponse(data: unknown): TokenHealthResponse {
  return TokenHealthResponseSchema.parse(data)
}

/**
 * Safe parsers that return a result object instead of throwing
 */
export function safeParseTokenResponse(
  data: unknown
):
  | { success: true; data: TokenResponse }
  | { success: false; error: z.ZodError } {
  const result = TokenResponseSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

export function safeParseTokenErrorResponse(
  data: unknown
):
  | { success: true; data: TokenErrorResponse }
  | { success: false; error: z.ZodError } {
  const result = TokenErrorResponseSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

export function safeParseTokenHealthResponse(
  data: unknown
):
  | { success: true; data: TokenHealthResponse }
  | { success: false; error: z.ZodError } {
  const result = TokenHealthResponseSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Zod schema for Spotify error responses
 */
export const SpotifyErrorResponseSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional()
})

/**
 * Safe parser for Spotify error responses
 */
export function safeParseSpotifyErrorResponse(
  data: unknown
):
  | { success: true; data: { error?: string; error_description?: string } }
  | { success: false; error: z.ZodError } {
  const result = SpotifyErrorResponseSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Zod schema for premium verification response
 * Note: This should match the response from /api/auth/verify-premium
 */
export const PremiumVerificationResponseSchema = z.object({
  isPremium: z.boolean(),
  productType: z.string(),
  userProfile: z
    .object({
      display_name: z.string(),
      external_urls: z.object({ spotify: z.string() }),
      followers: z.object({
        href: z.string().nullable(),
        total: z.number()
      }),
      href: z.string(),
      id: z.string(),
      images: z.array(
        z.object({
          height: z.number().nullable(),
          url: z.string(),
          width: z.number().nullable()
        })
      ),
      type: z.string(),
      uri: z.string(),
      product: z.enum([
        'free',
        'premium',
        'premium_duo',
        'premium_family',
        'premium_student',
        'open'
      ])
    })
    .optional(),
  cached: z.boolean().optional()
})

/**
 * Safe parser for premium verification responses
 */
export function safeParsePremiumVerificationResponse(data: unknown):
  | {
      success: true
      data: {
        isPremium: boolean
        productType: string
        userProfile?: {
          display_name: string
          external_urls: { spotify: string }
          followers: { href: string | null; total: number }
          href: string
          id: string
          images: Array<{
            height: number | null
            url: string
            width: number | null
          }>
          type: string
          uri: string
          product:
            | 'free'
            | 'premium'
            | 'premium_duo'
            | 'premium_family'
            | 'premium_student'
            | 'open'
        }
        cached?: boolean
      }
    }
  | { success: false; error: z.ZodError } {
  const result = PremiumVerificationResponseSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}
