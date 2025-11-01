/**
 * Utility functions for extracting colors from album artwork images
 */

export interface ColorPalette {
  dominant: string
  accent1: string
  accent2: string
  background: string
  foreground: string
}

export const DEFAULT_PALETTE: ColorPalette = {
  dominant: '#1db954',
  accent1: '#b3b3b3',
  accent2: '#535353',
  background: '#000000',
  foreground: '#ffffff'
}

// Cache for extracted colors
const colorCache = new Map<string, ColorPalette>()

/**
 * Converts RGB color to hex string
 */
function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = x.toString(16)
        return hex.length === 1 ? '0' + hex : hex
      })
      .join('')
  )
}

/**
 * Converts hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : null
}

/**
 * Calculates luminance of a color (for determining if text should be light/dark)
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    val = val / 255
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Checks if a color is light (to determine contrast color)
 */
function isLight(r: number, g: number, b: number): boolean {
  return getLuminance(r, g, b) > 0.5
}

/**
 * Quantizes colors into bins for clustering
 */
function quantizeColor(
  r: number,
  g: number,
  b: number,
  levels: number
): number {
  const binSize = 256 / levels
  const qr = Math.floor(r / binSize)
  const qg = Math.floor(g / binSize)
  const qb = Math.floor(b / binSize)
  return qr * levels * levels + qg * levels + qb
}

/**
 * Extracts dominant colors from an image
 */
function extractColorsFromImageData(
  imageData: ImageData,
  sampleSize = 10
): ColorPalette {
  const { data, width, height } = imageData
  const colorFreq = new Map<number, number>()
  const colorSamples: Array<{ r: number; g: number; b: number }> = []

  // Sample pixels at intervals (not every pixel for performance)
  const step = Math.max(1, Math.floor(Math.min(width, height) / sampleSize))

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      const a = data[index + 3]

      // Skip transparent pixels
      if (a < 128) continue

      const quantized = quantizeColor(r, g, b, 16)
      colorFreq.set(quantized, (colorFreq.get(quantized) || 0) + 1)
      colorSamples.push({ r, g, b })
    }
  }

  if (colorSamples.length === 0) {
    return DEFAULT_PALETTE
  }

  // Sort by frequency and get dominant colors
  const sortedColors = Array.from(colorFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([quantized]) => {
      const levels = 16
      const r = Math.floor(quantized / (levels * levels))
      const g = Math.floor((quantized / levels) % levels)
      const b = quantized % levels
      const binSize = 256 / levels
      return {
        r: Math.floor(r * binSize + binSize / 2),
        g: Math.floor(g * binSize + binSize / 2),
        b: Math.floor(b * binSize + binSize / 2)
      }
    })

  const dominant = sortedColors[0]
  const accent1 = sortedColors[1] || dominant
  const accent2 = sortedColors[2] || accent1

  // Calculate average color for background
  const avgColor = colorSamples.reduce(
    (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
    { r: 0, g: 0, b: 0 }
  )
  const count = colorSamples.length
  const background = {
    r: Math.floor(avgColor.r / count),
    g: Math.floor(avgColor.g / count),
    b: Math.floor(avgColor.b / count)
  }

  // Determine foreground color (contrast to dominant)
  const foreground = isLight(dominant.r, dominant.g, dominant.b)
    ? '#000000'
    : '#ffffff'

  return {
    dominant: rgbToHex(dominant.r, dominant.g, dominant.b),
    accent1: rgbToHex(accent1.r, accent1.g, accent1.b),
    accent2: rgbToHex(accent2.r, accent2.g, accent2.b),
    background: rgbToHex(background.r, background.g, background.b),
    foreground
  }
}

/**
 * Extracts dominant colors from an album artwork URL
 * Caches results to avoid re-processing
 */
export async function extractColorsFromImageUrl(
  imageUrl: string | undefined | null
): Promise<ColorPalette> {
  // Return default if no URL
  if (!imageUrl) {
    return DEFAULT_PALETTE
  }

  // Check cache
  if (colorCache.has(imageUrl)) {
    return colorCache.get(imageUrl)!
  }

  try {
    // Load image
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.loading = 'eager'

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = imageUrl
    })

    // Create canvas
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Could not get canvas context')
    }

    canvas.width = img.width
    canvas.height = img.height

    // Draw image to canvas
    ctx.drawImage(img, 0, 0)

    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    // Extract colors
    const palette = extractColorsFromImageData(imageData)

    // Cache result
    colorCache.set(imageUrl, palette)

    return palette
  } catch {
    // Return default palette on error (no logging needed for color extraction failures)
    return DEFAULT_PALETTE
  }
}

/**
 * Clears the color cache (useful for memory management)
 */
export function clearColorCache(): void {
  colorCache.clear()
}

/**
 * Creates a gradient CSS string from a color palette
 */
export function createGradientFromPalette(
  palette: ColorPalette,
  type: 'linear' | 'radial' = 'linear'
): string {
  if (type === 'linear') {
    return `linear-gradient(135deg, ${palette.dominant}, ${palette.accent1})`
  }
  return `radial-gradient(circle, ${palette.dominant}, ${palette.accent1}, ${palette.background})`
}
