import { recoveryManager } from '@/services/player'
import { tokenManager } from '@/shared/token/tokenManager'
import { transferPlaybackToDevice } from '@/services/deviceManagement'
import { isPremiumRequiredError } from '@/shared/utils/errorHandling'
import { PLAYER_LIFECYCLE_CONFIG } from '../playerLifecycleConfig'
import type { TimeoutManager } from './utils'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import { PlayerSDKState, StateProcessorInterface, isPlayerSDKState } from './types'

interface SDKLifecycleInterface {
  createPlayer(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<string>
  destroyPlayer(options: { resetRecovery: boolean }): void
  reloadSDK(): Promise<void>
  getDeviceId(): string | null
  getPlayerRef(): Spotify.Player | null
}

interface DeviceErrorCallbacks {
  getNavigationCallback(): ((path: string) => void) | null
  log(level: LogLevel, message: string, error?: unknown): void
  stateProcessor: StateProcessorInterface
}

export class DeviceErrorHandler {
  private isRecoveryNeeded: boolean = false
  private consecutiveNullStates: number = 0

  constructor(
    private readonly sdkLifecycle: SDKLifecycleInterface,
    private readonly timeoutManager: TimeoutManager,
    private readonly callbacks: DeviceErrorCallbacks
  ) {}

  reset(): void {
    this.consecutiveNullStates = 0
  }

  async handleAuthenticationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<void> {
    // Phase 3: Check if recovery is possible
    if (!recoveryManager.canAttemptRecovery()) {
      onStatusChange(
        'error',
        `Authentication failed after ${recoveryManager.getRetryCount()} attempts. Click to reload player.`
      )
      this.isRecoveryNeeded = true
      return
    }

    // Phase 3: Record recovery attempt
    recoveryManager.recordAttempt()

    try {
      tokenManager.clearCache()

      // Attempt to get a fresh token (this will use the recovery logic in API endpoints)
      const token = await tokenManager.getToken()

      if (!token) {
        throw new Error('Failed to obtain token after refresh')
      }

      onStatusChange(
        'initializing',
        `Refreshing authentication (attempt ${recoveryManager.getRetryCount()}/${PLAYER_LIFECYCLE_CONFIG.MAX_AUTH_RETRY_ATTEMPTS})`
      )

      this.sdkLifecycle.destroyPlayer({ resetRecovery: false })
      await this.sdkLifecycle.createPlayer(
        onStatusChange,
        onDeviceIdChange,
        onPlaybackStateChange
      )

      // Phase 3: Reset recovery state on success
      recoveryManager.recordSuccess()
      this.isRecoveryNeeded = false
    } catch (error) {
      // Check both error message and error code if available
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const errorCode =
        error instanceof Error && 'code' in error
          ? (error as Error & { code?: string }).code
          : undefined

      const needsUserAction =
        errorCode === 'INVALID_REFRESH_TOKEN' ||
        errorCode === 'INVALID_CLIENT_CREDENTIALS' ||
        errorCode === 'NO_REFRESH_TOKEN' ||
        errorCode === 'NOT_AUTHENTICATED' ||
        errorMessage.includes('INVALID_REFRESH_TOKEN') ||
        errorMessage.includes('INVALID_CLIENT_CREDENTIALS') ||
        errorMessage.includes('NO_REFRESH_TOKEN') ||
        errorMessage.includes('NOT_AUTHENTICATED')

      // Phase 3: Check if recovery should stop
      if (needsUserAction || !recoveryManager.canAttemptRecovery()) {
        // Last resort: require manual recovery
        onStatusChange('error', 'Player recovery failed. Click to reload.')
        this.isRecoveryNeeded = true
      } else {
        // Schedule retry for recoverable errors
        onStatusChange(
          'error',
          `Authentication error (attempt ${recoveryManager.getRetryCount()}/${PLAYER_LIFECYCLE_CONFIG.MAX_AUTH_RETRY_ATTEMPTS}). Retrying...`
        )
        this.timeoutManager.setTask(
          'authRetry',
          () => {
            void this.handleAuthenticationError(
              message,
              onStatusChange,
              onDeviceIdChange,
              onPlaybackStateChange
            )
          },
          5000,
          'background'
        )
      }
    }
  }

  handlePlayerStateChangeEvent(
    state: unknown,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void
  ): void {
    if (!state) {
      // Lightweight recovery: Don't immediately recreate player
      this.consecutiveNullStates++

      const NULL_STATE_THRESHOLD =
        PLAYER_LIFECYCLE_CONFIG.STATE_MONITORING.nullStateThreshold

      if (this.consecutiveNullStates >= NULL_STATE_THRESHOLD) {
        this.consecutiveNullStates = 0

        // Try a lightweight device transfer first — null states are commonly caused
        // by the device becoming inactive (e.g. user opens Spotify elsewhere), not
        // by an auth failure. Jumping straight to handleAuthenticationError wastes
        // retry budget and destroys/recreates the player unnecessarily.
        const deviceId = this.sdkLifecycle.getDeviceId()
        if (deviceId) {
          void (async () => {
            try {
              const transferred = await transferPlaybackToDevice(deviceId)
              if (transferred) {
                onStatusChange('ready', undefined)
              } else {
                void this.handleAuthenticationError(
                  'Device persistently inactive',
                  onStatusChange,
                  onDeviceIdChange,
                  onPlaybackStateChange
                ).catch(() => {})
              }
            } catch {
              void this.handleAuthenticationError(
                'Device persistently inactive',
                onStatusChange,
                onDeviceIdChange,
                onPlaybackStateChange
              ).catch(() => {})
            }
          })()
        } else {
          void this.handleAuthenticationError(
            'Device persistently inactive',
            onStatusChange,
            onDeviceIdChange,
            onPlaybackStateChange
          ).catch(() => {})
        }
      }
      return
    }

    // Reset null state counter on successful state
    this.consecutiveNullStates = 0

    // Runtime validation
    if (!isPlayerSDKState(state)) {
      return
    }

    void this.callbacks.stateProcessor
      .processStateChange(state, onPlaybackStateChange)
      .catch((e) => this.callbacks.log('ERROR', 'processStateChange failed', e))
  }

  handleNotReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    const timeoutKey = 'notReady'
    this.timeoutManager.clear(timeoutKey)

    // Background recovery: Try to reactivate the device without destroying the player
    // Add a grace period before triggering recovery to avoid thrashing
    const RECOVERY_GRACE_PERIOD_MS =
      PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.recoveryGracePeriodMs

    this.timeoutManager.setTask(
      timeoutKey,
      () => {
        void (async () => {
          try {
            // Guard: Check if player was destroyed while we were waiting
            if (!this.sdkLifecycle.getPlayerRef()) {
              return
            }

            // Try to transfer playback back to this device
            const transferred = await transferPlaybackToDevice(deviceId)

            // Re-check player existence after async operation
            if (!this.sdkLifecycle.getPlayerRef()) {
              return
            }

            if (transferred) {
              onStatusChange('ready', undefined)
            } else {
              // Only trigger full recovery if background transfer fails
              onStatusChange(
                'recovery_needed',
                'Device recovery failed. Player may need to be recreated.'
              )
            }
          } catch {
            if (this.sdkLifecycle.getPlayerRef()) {
              onStatusChange(
                'recovery_needed',
                'Device recovery error. Player may need to be recreated.'
              )
            }
          }
        })()
      },
      RECOVERY_GRACE_PERIOD_MS,
      'background'
    )
  }

  handleAccountError(message: string): void {
    if (isPremiumRequiredError(new Error(message))) {
      const navigationCallback = this.callbacks.getNavigationCallback()
      if (navigationCallback) {
        navigationCallback('/premium-required')
      } else {
        // Issue #7 fix: Don't manipulate DOM directly - throw error instead
        throw new Error(
          'Premium account required but navigation callback not configured'
        )
      }
    }
  }

  async forceRecovery(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<void> {
    // Phase 3: Reset recovery state on device ready
    recoveryManager.recordSuccess()
    this.isRecoveryNeeded = false

    try {
      await this.sdkLifecycle.reloadSDK()
      await this.sdkLifecycle.createPlayer(
        onStatusChange,
        onDeviceIdChange,
        onPlaybackStateChange
      )
    } catch {
      onStatusChange('error', 'Recovery failed. Please refresh the page.')
    }
  }
}
