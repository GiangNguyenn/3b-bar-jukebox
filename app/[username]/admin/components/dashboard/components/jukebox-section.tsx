'use client'

import { useParams } from 'next/navigation'
import Image from 'next/image'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { Loading } from '@/components/ui'
import { usePlaybackControls } from '../../../hooks/usePlaybackControls'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { useState, useRef } from 'react'
import { Copy, Check, QrCode } from 'lucide-react'
import { QRCodeComponent } from '@/components/ui'
import { getAutoPlayService } from '@/services/autoPlayService'

interface JukeboxSectionProps {
  className?: string
}

export function JukeboxSection({
  className = ''
}: JukeboxSectionProps): JSX.Element {
  const params = useParams()
  const username = params?.username as string | undefined
  const { deviceId, isReady } = useSpotifyPlayerStore()
  const { addLog } = useConsoleLogsContext()
  const [volume, setVolume] = useState(50)
  const [copied, setCopied] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const progressBarRef = useRef<HTMLDivElement>(null)

  const { data: currentlyPlaying, isLoading } = useNowPlayingTrack({
    token: null, // Use admin credentials
    enabled: true,
    refetchInterval: 20000 // Poll every 20 seconds - reduces API calls while maintaining reasonable responsiveness
  })

  const { handlePlayPause, handleSkip, isActuallyPlaying, isSkipLoading } =
    usePlaybackControls()

  const handleOpenJukebox = (): void => {
    if (username) {
      const jukeboxUrl = `/${username}/playlist`
      window.open(jukeboxUrl, '_blank')
    }
  }

  const handleOpenDisplay = (): void => {
    if (username) {
      const displayUrl = `/${username}/display`
      window.open(displayUrl, '_blank')
    }
  }

  const handleCopyLink = async (): Promise<void> => {
    if (username) {
      const jukeboxUrl = `${window.location.origin}/${username}/playlist`
      try {
        await navigator.clipboard.writeText(jukeboxUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (error) {
        addLog(
          'ERROR',
          'Failed to copy link to clipboard',
          'JukeboxSection',
          error instanceof Error ? error : undefined
        )
      }
    }
  }

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const formatProgress = (progress: number, duration: number): string => {
    const progressSeconds = Math.floor(progress / 1000)
    const durationSeconds = Math.floor(duration / 1000)
    const progressMinutes = Math.floor(progressSeconds / 60)
    const durationMinutes = Math.floor(durationSeconds / 60)
    const progressRemainingSeconds = progressSeconds % 60
    const durationRemainingSeconds = durationSeconds % 60

    return `${progressMinutes}:${progressRemainingSeconds.toString().padStart(2, '0')} / ${durationMinutes}:${durationRemainingSeconds.toString().padStart(2, '0')}`
  }

  const getProgressPercentage = (
    progress: number,
    duration: number
  ): number => {
    return Math.min((progress / duration) * 100, 100)
  }

  const handleSeek = async (clientX: number): Promise<void> => {
    if (
      !progressBarRef.current ||
      !deviceId ||
      !currentlyPlaying?.item?.duration_ms
    )
      return

    const rect = progressBarRef.current.getBoundingClientRect()
    const clickPosition = clientX - rect.left
    const clickPercentage = Math.max(0, Math.min(1, clickPosition / rect.width))
    const seekPosition = Math.floor(
      clickPercentage * currentlyPlaying.item.duration_ms
    )

    setIsSeeking(true)
    try {
      await sendApiRequest({
        path: `me/player/seek?position_ms=${seekPosition}${deviceId ? `&device_id=${deviceId}` : ''}`,
        method: 'PUT'
      })

      // Reset predictive state after seeking to prevent stale track preparation
      // This will also immediately prepare next track if we seeked to near the end
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      void getAutoPlayService().resetAfterSeek()
    } catch (error) {
      addLog(
        'ERROR',
        'Failed to seek',
        'JukeboxSection',
        error instanceof Error ? error : undefined
      )
    } finally {
      setTimeout(() => setIsSeeking(false), 500)
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!isDragging) {
      void handleSeek(e.clientX)
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    setIsDragging(true)
    void handleSeek(e.clientX)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (isDragging) {
      void handleSeek(e.clientX)
    }
  }

  const handleMouseUp = (): void => {
    setIsDragging(false)
  }

  const handleMouseLeave = (): void => {
    if (isDragging) {
      setIsDragging(false)
    }
  }

  return (
    <div
      className={`rounded-lg border border-gray-800 bg-gray-900/50 p-4 ${className}`}
    >
      <div className='space-y-4'>
        <div>
          <h3 className='text-white text-lg font-semibold'>Jukebox Controls</h3>
        </div>

        {/* Currently Playing Track */}
        {currentlyPlaying?.item && (
          <div className='space-y-3'>
            <div className='flex items-center gap-3'>
              {currentlyPlaying.item.album?.images?.[0]?.url && (
                <Image
                  src={currentlyPlaying.item.album.images[0].url}
                  alt={currentlyPlaying.item.name}
                  width={48}
                  height={48}
                  className='h-12 w-12 rounded-md object-cover'
                  unoptimized
                  crossOrigin='anonymous'
                />
              )}
              <div className='min-w-0 flex-1'>
                <div className='text-white truncate text-sm font-medium'>
                  {currentlyPlaying.item.name}
                </div>
                <div className='truncate text-xs text-gray-400'>
                  {currentlyPlaying.item.artists?.[0]?.name || 'Unknown Artist'}
                </div>
              </div>
              <div className='text-xs text-gray-400'>
                {currentlyPlaying.progress_ms &&
                currentlyPlaying.item.duration_ms
                  ? formatProgress(
                      currentlyPlaying.progress_ms,
                      currentlyPlaying.item.duration_ms
                    )
                  : formatTime(currentlyPlaying.item.duration_ms)}
              </div>
            </div>

            {/* Progress Bar - Clickable */}
            {currentlyPlaying.progress_ms &&
              currentlyPlaying.item.duration_ms && (
                <div className='space-y-1'>
                  <div
                    ref={progressBarRef}
                    className='h-2 w-full cursor-pointer rounded-full bg-gray-700 transition-all hover:h-2.5'
                    onClick={handleClick}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    title='Click or drag to seek'
                  >
                    <div
                      className={`pointer-events-none h-full rounded-full transition-all ${isSeeking ? 'bg-blue-500' : 'bg-green-500'}`}
                      style={{
                        width: `${getProgressPercentage(currentlyPlaying.progress_ms, currentlyPlaying.item.duration_ms)}%`,
                        transitionDuration: isSeeking ? '0ms' : '1000ms'
                      }}
                    />
                  </div>
                  <div className='flex justify-between text-xs text-gray-400'>
                    <span>{formatTime(currentlyPlaying.progress_ms)}</span>
                    <span>{formatTime(currentlyPlaying.item.duration_ms)}</span>
                  </div>
                </div>
              )}
          </div>
        )}

        {isLoading && !currentlyPlaying?.item && (
          <div className='flex items-center justify-center py-4'>
            <Loading className='h-4 w-4' />
            <span className='ml-2 text-sm text-gray-400'>
              Loading track info...
            </span>
          </div>
        )}

        {!isLoading && !currentlyPlaying?.item && (
          <div className='py-4 text-center text-sm text-gray-400'>
            No track currently playing
          </div>
        )}

        {/* Playback Controls */}
        <div className='space-y-4'>
          {/* Play/Pause and Skip Buttons */}
          <div className='flex justify-center gap-4'>
            <button
              type='button'
              onClick={(): void => {
                void handlePlayPause()
              }}
              disabled={!isReady}
              className='text-white flex-1 rounded-lg bg-green-600 px-6 py-3 font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isActuallyPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type='button'
              onClick={(): void => {
                void handleSkip()
              }}
              disabled={!isReady || !isActuallyPlaying || isSkipLoading}
              className='text-white flex-1 rounded-lg bg-blue-600 px-6 py-3 font-medium transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isSkipLoading ? (
                <div className='flex items-center justify-center gap-2'>
                  <Loading className='h-4 w-4' />
                  <span>Skipping...</span>
                </div>
              ) : (
                'Skip'
              )}
            </button>
          </div>

          {/* Volume Control */}
          <div>
            <label className='text-white mb-2 block text-sm font-medium'>
              Volume
            </label>
            <div className='space-y-1'>
              <input
                type='range'
                min='0'
                max='100'
                value={volume}
                className='slider h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-700'
                onChange={(e): void => {
                  const newVolume = parseInt(e.target.value)
                  setVolume(newVolume)
                  void (async () => {
                    try {
                      await sendApiRequest({
                        path: `me/player/volume?volume_percent=${newVolume}&device_id=${deviceId}`,
                        method: 'PUT'
                      })
                      addLog(
                        'INFO',
                        `Volume set to ${newVolume}%`,
                        'JukeboxSection'
                      )
                    } catch (error) {
                      addLog(
                        'ERROR',
                        'Failed to set volume',
                        'JukeboxSection',
                        error instanceof Error ? error : undefined
                      )
                    }
                  })()
                }}
                disabled={!isReady}
              />
              <div className='flex justify-center text-xs text-gray-400'>
                <span>{volume}%</span>
              </div>
            </div>
          </div>
        </div>

        <button
          type='button'
          onClick={handleOpenDisplay}
          disabled={!username}
          className='text-white w-full rounded-lg bg-blue-600 px-4 py-3 font-medium transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
        >
          Open Display
        </button>

        <button
          type='button'
          onClick={handleOpenJukebox}
          disabled={!username}
          className='text-white w-full rounded-lg bg-purple-600 px-4 py-3 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
        >
          Open Jukebox
        </button>

        {/* Copy Jukebox Link */}
        {username && (
          <div className='space-y-2'>
            <div className='flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2'>
              <span className='flex-1 truncate text-sm text-gray-300'>
                {`${window.location.origin}/${username}/playlist`}
              </span>
              <div className='flex items-center gap-1'>
                <button
                  type='button'
                  onClick={(): void => {
                    setShowQRCode(!showQRCode)
                  }}
                  className='hover:text-white flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-700'
                  title='Show/hide QR code'
                >
                  <QrCode className='h-4 w-4' />
                </button>
                <button
                  type='button'
                  onClick={(): void => {
                    void handleCopyLink()
                  }}
                  className='hover:text-white flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-700'
                  title='Copy link to clipboard'
                >
                  {copied ? (
                    <Check className='h-4 w-4 text-green-500' />
                  ) : (
                    <Copy className='h-4 w-4' />
                  )}
                </button>
              </div>
            </div>
            <p className='text-center text-xs text-gray-400'>
              {copied
                ? 'Link copied!'
                : 'Public jukebox page - share with guests (no Spotify account required)'}
            </p>

            {/* QR Code Section */}
            {showQRCode && (
              <div className='mt-4 rounded-lg border border-gray-700 bg-gray-800/50 p-4'>
                <div className='mb-3 text-center'>
                  <h4 className='text-white text-sm font-medium'>QR Code</h4>
                  <p className='text-xs text-gray-400'>
                    Scan to open the jukebox page
                  </p>
                </div>
                <QRCodeComponent
                  url={`${window.location.origin}/${username}/playlist`}
                  size={180}
                  className='mx-auto'
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
