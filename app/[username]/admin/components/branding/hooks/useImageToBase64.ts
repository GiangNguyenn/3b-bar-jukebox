import { useState } from 'react'

export function useImageToBase64(): {
  uploadFile: (file: File, type: 'logo' | 'favicon') => Promise<string>
  uploading: boolean
} {
  const [uploading, setUploading] = useState(false)

  const uploadFile = async (
    file: File,
    type: 'logo' | 'favicon'
  ): Promise<string> => {
    setUploading(true)

    try {
      // Convert file to base64
      const base64 = await fileToBase64(file)

      return base64
    } catch {
      throw new Error(`Failed to convert ${type} to base64`)
    } finally {
      setUploading(false)
    }
  }

  // Helper function to convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (): void => resolve(reader.result as string)
      reader.onerror = (): void => reject(new Error('Failed to read file'))
    })
  }

  return {
    uploadFile,
    uploading
  }
} 