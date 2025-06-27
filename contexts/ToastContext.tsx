'use client'

import { useState, useEffect, useCallback } from 'react'
import { Toast } from '@/components/ui/toast'
import { toastManager } from '@/lib/toast'

type ToastVariant = 'success' | 'info' | 'warning'

interface ToastMessage {
  id: number
  message: string
  variant: ToastVariant
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    const handleShowToast = (message: string, variant: ToastVariant) => {
      const id = Date.now()
      setToasts((prevToasts) => [...prevToasts, { id, message, variant }])
    }

    const unsubscribe = toastManager.subscribe(handleShowToast)
    return () => unsubscribe()
  }, [])

  const removeToast = useCallback((id: number) => {
    setToasts((prevToasts) => prevToasts.filter((toast) => toast.id !== id))
  }, [])

  return (
    <>
      {children}
      <div className='fixed right-4 top-4 z-50 space-y-2'>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            variant={toast.variant}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </>
  )
}
