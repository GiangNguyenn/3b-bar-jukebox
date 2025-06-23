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

/**
 * Creates a standardized logger for any module
 * @param moduleName - The name of the module (used as context)
 * @param setLoggerFn - Optional function to set the logger in a specific service
 * @returns A logger function that can be used throughout the module
 */
export function createModuleLogger(
  moduleName: string,
  setLoggerFn?: (logger: LogFunction) => void
): LogFunction {
  // Create the logger function
  const logger: LogFunction = (level, message, context, error) => {
    const logContext = context || moduleName
    if (level === 'ERROR') {
      console.error(`[${logContext}] ${message}`, error)
    } else if (level === 'WARN') {
      console.warn(`[${logContext}] ${message}`, error)
    } else {
      console.log(`[${logContext}] ${message}`)
    }
  }

  // Set up the logger in the API system if requested
  if (setLoggerFn) {
    setLoggerFn(logger)
  }

  return logger
}
