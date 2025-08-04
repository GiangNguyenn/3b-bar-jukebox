import { z } from 'zod'

export const brandingSettingsSchema = z.object({
  venue_name: z
    .string()
    .max(50, 'Venue name must be 50 characters or less')
    .nullable()
    .optional(),
  subtitle: z
    .string()
    .max(100, 'Subtitle must be 100 characters or less')
    .nullable()
    .optional(),
  welcome_message: z
    .string()
    .max(500, 'Welcome message must be 500 characters or less')
    .nullable()
    .optional(),
  footer_text: z
    .string()
    .max(200, 'Footer text must be 200 characters or less')
    .nullable()
    .optional(),
  page_title: z
    .string()
    .max(60, 'Page title must be 60 characters or less')
    .nullable()
    .optional(),
  meta_description: z
    .string()
    .max(160, 'Meta description must be 160 characters or less')
    .nullable()
    .optional(),
  open_graph_title: z
    .string()
    .max(60, 'Open Graph title must be 60 characters or less')
    .nullable()
    .optional(),
  font_family: z.string().nullable().optional(),
  font_size: z.string().nullable().optional(),
  font_weight: z.string().nullable().optional(),
  text_color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Invalid color format')
    .nullable()
    .optional(),
  primary_color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Invalid color format')
    .nullable()
    .optional(),
  secondary_color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Invalid color format')
    .nullable()
    .optional(),
  background_color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Invalid color format')
    .nullable()
    .optional(),
  accent_color_1: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Invalid color format')
    .nullable()
    .optional(),
  accent_color_2: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Invalid color format')
    .nullable()
    .optional(),
  accent_color_3: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Invalid color format')
    .nullable()
    .optional(),
  gradient_type: z.enum(['none', 'linear', 'radial']).nullable().optional(),
  gradient_direction: z.string().nullable().optional(),
  gradient_stops: z.string().nullable().optional(),
  logo_url: z
    .string()
    .startsWith('data:image/', 'Invalid image format')
    .nullable()
    .optional(),
  favicon_url: z
    .string()
    .startsWith('data:image/', 'Invalid image format')
    .nullable()
    .optional()
})

export type BrandingSettingsInput = z.infer<typeof brandingSettingsSchema>

export function validateBrandingSettings(data: unknown): BrandingSettingsInput {
  return brandingSettingsSchema.parse(data)
}

export function validateBrandingSettingsPartial(
  data: unknown
): Partial<BrandingSettingsInput> {
  const validated = brandingSettingsSchema.partial().parse(data)

  // Convert null values to undefined for optional fields
  const cleaned: Partial<BrandingSettingsInput> = {}
  Object.entries(validated).forEach(([key, value]) => {
    if (value !== null) {
      ;(cleaned as Record<string, unknown>)[key] = value
    }
  })

  return cleaned
}
