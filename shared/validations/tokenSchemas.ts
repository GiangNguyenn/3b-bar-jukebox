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
