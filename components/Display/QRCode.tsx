'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import QRCode from 'qrcode'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'

interface QRCodeProps {
  username: string
}

export default function QRCodeComponent({
  username
}: QRCodeProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { addLog } = useConsoleLogsContext()
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null)

  // Handle SSR safety - only set URL on client side
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPlaylistUrl(`${window.location.origin}/${username}/playlist`)
    }
  }, [username])

  // Generate QR code
  useEffect(() => {
    if (!playlistUrl || !canvasRef.current) return

    const generateQRCode = async (): Promise<void> => {
      if (!canvasRef.current) return

      try {
        const canvas = canvasRef.current
        await QRCode.toCanvas(canvas, playlistUrl, {
          width: 240,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        })
      } catch (err) {
        addLog(
          'ERROR',
          'Failed to generate QR code',
          'QRCodeComponent',
          err as Error
        )
      }
    }

    void generateQRCode()
  }, [playlistUrl, addLog])

  return (
    <div className='fixed right-4 top-4 z-[100]'>
      <div className='bg-white rounded-lg p-3 shadow-2xl'>
        <canvas
          ref={canvasRef}
          width={240}
          height={240}
          className='bg-white block'
        />
        <p className='text-white mt-3 text-center text-xl font-bold'>
          Scan to add songs
        </p>
      </div>
    </div>
  )
}
