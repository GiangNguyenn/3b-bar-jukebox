type ToastVariant = 'success' | 'info' | 'warning'
type ToastListener = (message: string, variant: ToastVariant) => void

class ToastManager {
  private listeners: ToastListener[] = []

  subscribe(listener: ToastListener): () => void {
    this.listeners.push(listener)
    return (): void => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  show(message: string, variant: ToastVariant = 'info'): void {
    this.listeners.forEach((listener) => listener(message, variant))
  }
}

export const toastManager = new ToastManager()

export const showToast = (
  message: string,
  variant: ToastVariant = 'info'
): void => {
  toastManager.show(message, variant)
}
