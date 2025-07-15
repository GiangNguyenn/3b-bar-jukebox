import { ZodType, ZodError } from 'zod'

export function parseWithType<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) throw result.error
  return result.data
}
