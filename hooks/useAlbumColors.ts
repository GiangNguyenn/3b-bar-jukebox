import { useEffect, useState } from 'react'
import {
  extractColorsFromImageUrl,
  type ColorPalette
} from '@/shared/utils/colorExtraction'
import { DEFAULT_PALETTE } from '@/shared/utils/colorExtraction'

export function useAlbumColors(imageUrl: string | undefined): {
  colors: ColorPalette
  isLoading: boolean
  error: Error | null
} {
  const [colors, setColors] = useState<ColorPalette>(DEFAULT_PALETTE)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    async function fetchColors() {
      if (!imageUrl) {
        setColors(DEFAULT_PALETTE)
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)
        const palette = await extractColorsFromImageUrl(imageUrl)
        setColors(palette)
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to extract colors')
        setError(error)
        setColors(DEFAULT_PALETTE)
      } finally {
        setIsLoading(false)
      }
    }

    void fetchColors()
  }, [imageUrl])

  return { colors, isLoading, error }
}
