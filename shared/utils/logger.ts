import { setApiLogger } from '../api'
import { setTokenManagerLogger } from '../token/tokenManager'
import { setSpotifyApiLogger } from '../../services/spotifyApi'
import { setDeviceManagementLogger } from '../../services/deviceManagement'
import { setTrackSuggestionLogger } from '../../services/trackSuggestion'

export type LogFunction = (
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context?: string,
  error?: Error
) => void

export function initializeLoggers(addLog: LogFunction): void {
  // Initialize all service loggers
  setApiLogger(addLog)
  setTokenManagerLogger(addLog)
  setSpotifyApiLogger(addLog)
  setDeviceManagementLogger(addLog)
  setTrackSuggestionLogger(addLog)
}
