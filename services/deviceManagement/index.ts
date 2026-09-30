// Re-export all device management functions
export {
  getAvailableDevices,
  getPlaybackState,
  findDevice,
  listDevices,
  setDeviceApiLogger
} from './deviceApi'

export {
  validateDevice,
  setDeviceValidationLogger,
  DEVICE_NOT_FOUND_ERROR,
  describeMissingDevice
} from './deviceValidation'

export {
  transferPlaybackToDevice,
  cleanupOtherDevices,
  setDeviceTransferLogger
} from './deviceTransfer'

// Import logger functions for the consolidated logger
import { setDeviceApiLogger } from './deviceApi'
import { setDeviceValidationLogger } from './deviceValidation'
import { setDeviceTransferLogger } from './deviceTransfer'

// Set up logging for all modules
export function setDeviceManagementLogger(
  logger: (
    level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
    message: string,
    context?: string,
    error?: Error
  ) => void
): void {
  setDeviceApiLogger(logger)
  setDeviceValidationLogger(logger)
  setDeviceTransferLogger(logger)
}
