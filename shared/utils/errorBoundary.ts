export const executeWithErrorBoundary = async <T,>(
  operation: () => Promise<T>,
  errorContext: string
): Promise<T | null> => {
  try {
    return await operation()
  } catch (error) {
    console.error(`[${errorContext}] Operation failed:`, error)
    return null
  }
} 