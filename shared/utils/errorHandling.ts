import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors';

interface ApiError {
  message?: string;
  error?: {
    message?: string;
    status?: number;
  };
  details?: {
    errorMessage?: string;
  };
}

export class AppError extends Error {
  constructor(
    public message: ErrorMessage,
    public originalError?: unknown,
    public context?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const handleApiError = (error: unknown, context: string): AppError => {
  console.error(`[${context}] Error:`, error);
  
  if (error instanceof AppError) {
    return error;
  }

  let errorMessage: ErrorMessage = ERROR_MESSAGES.GENERIC_ERROR;
  
  if (error instanceof Error) {
    errorMessage = (error.message || ERROR_MESSAGES.GENERIC_ERROR) as ErrorMessage;
  } else if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiError;
    const message = apiError.message || 
                   apiError.error?.message || 
                   apiError.details?.errorMessage;
    errorMessage = (message || ERROR_MESSAGES.GENERIC_ERROR) as ErrorMessage;
  }
  
  return new AppError(errorMessage, error, context);
};

export const handleOperationError = async (
  operation: () => Promise<void>,
  context: string,
  onError?: (error: AppError) => void
): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    const appError = handleApiError(error, context);
    onError?.(appError);
    throw appError;
  }
};

export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError;
}; 