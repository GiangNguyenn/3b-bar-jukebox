'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Download } from 'lucide-react'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'

interface QRCodeProps {
  url: string
  size?: number
  className?: string
}

export function QRCodeComponent({
  url,
  size = 200,
  className = ''
}: QRCodeProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { addLog } = useConsoleLogsContext()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const generateQRCode = async (): Promise<void> => {
      if (!canvasRef.current) return

      try {
        setIsGenerating(true)
        setError(null)

        await QRCode.toCanvas(canvasRef.current, url, {
          width: size,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        })

        addLog('INFO', 'QR code generated successfully', 'QRCodeComponent')
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to generate QR code'
        setError(errorMessage)
        addLog(
          'ERROR',
          'Failed to generate QR code',
          'QRCodeComponent',
          err instanceof Error ? err : undefined
        )
      } finally {
        setIsGenerating(false)
      }
    }

    void generateQRCode()
  }, [url, size, addLog])

  const handleDownload = (): void => {
    if (!canvasRef.current) return

    try {
      const canvas = canvasRef.current
      const link = document.createElement('a')
      link.download = 'jukebox-qr-code.png'
      link.href = canvas.toDataURL()
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      addLog('INFO', 'QR code downloaded successfully', 'QRCodeComponent')
    } catch (err) {
      addLog(
        'ERROR',
        'Failed to download QR code',
        'QRCodeComponent',
        err instanceof Error ? err : undefined
      )
    }
  }

  if (error) {
    return (
      <div className={`text-center text-red-500 ${className}`}>
        <p className='text-sm'>Failed to generate QR code</p>
        <p className='text-xs text-gray-400'>{error}</p>
      </div>
    )
  }

  return (
    <div className={`flex flex-col items-center space-y-3 ${className}`}>
      <div className='relative'>
        <canvas
          ref={canvasRef}
          className='bg-white rounded-lg border border-gray-700'
          style={{ width: size, height: size }}
        />
        {isGenerating && (
          <div className='absolute inset-0 flex items-center justify-center rounded-lg bg-black bg-opacity-50'>
            <div className='text-white text-sm'>Generating...</div>
          </div>
        )}
      </div>

      <button
        onClick={() => handleDownload()}
        disabled={isGenerating}
        className='text-white flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50'
        title='Download QR code'
      >
        <Download className='h-4 w-4' />
        Download
      </button>
    </div>
  )
}
