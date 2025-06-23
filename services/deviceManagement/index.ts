// Re-export all device management functions
export {
  getAvailableDevices,
  getPlaybackState,
  findDevice,
  setDeviceApiLogger
} from './deviceApi'

export { validateDevice, setDeviceValidationLogger } from './deviceValidation'

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
) {
  setDeviceApiLogger(logger)
  setDeviceValidationLogger(logger)
  setDeviceTransferLogger(logger)
}
