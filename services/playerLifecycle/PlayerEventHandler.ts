import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { PlayerEventDispatcher } from './types'
import { describeTabVisibility } from '@/shared/utils/tabVisibility'

type SdkEventLog = (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void

const shortId = (id: string): string => `${id.slice(0, 8)}…`

export class PlayerEventHandler {
  /**
   * @param log Records each SDK event (context 'SpotifySDK'), so the moment
   *   and the reason a device dropped are visible in remote diagnostics.
   */
  constructor(
    private service: PlayerEventDispatcher,
    private onStatusChange: (status: string, error?: string) => void,
    private onDeviceIdChange: (deviceId: string) => void,
    private onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void,
    private log: SdkEventLog = (): void => {}
  ) {}

  attachListeners(player: Spotify.Player): void {
    player.addListener('ready', ({ device_id }) => {
      this.log('INFO', `ready: device ${shortId(device_id)} is online`)
      void (async () => {
        try {
          await this.service.handleDeviceReady(
            device_id,
            this.onStatusChange,
            this.onDeviceIdChange
          )
        } catch (error) {
          this.service.handleDeviceInitializationFailure(
            error,
            this.onStatusChange
          )
        }
      })()
    })

    player.addListener('not_ready', (event) => {
      this.log(
        'WARN',
        `not_ready: device ${shortId(event.device_id)} went offline (tab ${describeTabVisibility()})`
      )
      this.service.handleNotReady(event.device_id, this.onStatusChange)
    })

    player.addListener('initialization_error', ({ message }) => {
      this.log('ERROR', `initialization_error: ${message}`)
      this.service.handleInitializationError(message, this.onStatusChange)
    })

    player.addListener('authentication_error', ({ message }) => {
      this.log('ERROR', `authentication_error: ${message}`)
      void this.service.handleAuthenticationError(
        message,
        this.onStatusChange,
        this.onDeviceIdChange,
        this.onPlaybackStateChange
      )
    })

    player.addListener('account_error', ({ message }) => {
      this.log('ERROR', `account_error: ${message}`)
      this.service.handleAccountError(message)
      this.onStatusChange('error', `Account error: ${message}`)
    })

    player.addListener('playback_error', ({ message }) => {
      this.log('ERROR', `playback_error: ${message}`)
      this.service.handlePlaybackError(message)
    })

    player.addListener('autoplay_failed', () => {
      this.log(
        'WARN',
        'autoplay_failed: the browser blocked audio until someone interacts with the page'
      )
    })

    player.addListener('player_state_changed', (state) => {
      if (!state) {
        this.log(
          'WARN',
          'player_state_changed with no state: this device is not the active Spotify device'
        )
      }
      this.service.handlePlayerStateChangeEvent(
        state,
        this.onPlaybackStateChange,
        this.onStatusChange,
        this.onDeviceIdChange
      )
    })
  }
}
