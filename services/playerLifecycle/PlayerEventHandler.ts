import { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { PlayerLifecycleService } from '../playerLifecycle'

export class PlayerEventHandler {
  constructor(
    private service: PlayerLifecycleService,
    private onStatusChange: (status: string, error?: string) => void,
    private onDeviceIdChange: (deviceId: string) => void,
    private onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ) {}

  attachListeners(player: Spotify.Player): void {
    player.addListener('ready', ({ device_id }) => {
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
      this.service.handleNotReady(event.device_id, this.onStatusChange)
    })

    player.addListener('initialization_error', ({ message }) => {
      this.service.handleInitializationError(message, this.onStatusChange)
    })

    player.addListener('authentication_error', ({ message }) => {
      void this.service.handleAuthenticationError(
        message,
        this.onStatusChange,
        this.onDeviceIdChange,
        this.onPlaybackStateChange
      )
    })

    player.addListener('account_error', ({ message }) => {
      this.service.handleAccountError(message)
      this.onStatusChange('error', `Account error: ${message}`)
    })

    player.addListener('playback_error', ({ message }) => {
      this.service.handlePlaybackError(message)
    })

    player.addListener('player_state_changed', (state) => {
      this.service.handlePlayerStateChangeEvent(
        state,
        this.onPlaybackStateChange,
        this.onStatusChange,
        this.onDeviceIdChange
      )
    })
  }
}
