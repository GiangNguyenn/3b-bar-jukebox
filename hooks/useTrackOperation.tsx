import { useState, useEffect } from 'react';
import { TrackItem } from '@/shared/types';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { sendApiRequest } from '@/shared/api';

interface UseTrackOperationProps {
  playlistId: string | null;
  playlistError?: boolean;
  refetchPlaylist: () => Promise<void>;
}

interface TrackOperationState {
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
}

type TrackOperation = (track: TrackItem) => Promise<void>;

export const useTrackOperation = ({
  playlistId,
  playlistError = false,
  refetchPlaylist
}: UseTrackOperationProps): TrackOperationState & {
  executeOperation: (operation: TrackOperation, track: TrackItem) => Promise<void>;
} => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (!playlistId) return ERROR_MESSAGES.NO_PLAYLIST;
    if (playlistError) return 'Failed to load playlist';
    return null;
  });
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!playlistId) {
      setError(ERROR_MESSAGES.NO_PLAYLIST);
      setIsSuccess(false);
    } else if (playlistError) {
      setError('Failed to load playlist');
      setIsSuccess(false);
    }
  }, [playlistId, playlistError]);

  const executeOperation = async (operation: TrackOperation, track: TrackItem) => {
    if (!playlistId) {
      setError(ERROR_MESSAGES.NO_PLAYLIST);
      setIsSuccess(false);
      throw new Error(ERROR_MESSAGES.NO_PLAYLIST);
    }

    if (playlistError) {
      setError('Failed to load playlist');
      setIsSuccess(false);
      throw new Error('Failed to load playlist');
    }

    setIsLoading(true);
    setIsSuccess(false);

    try {
      await operation(track);
      await refetchPlaylist();
      setIsSuccess(true);
      setError(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Operation failed';
      setError(errorMessage);
      setIsSuccess(false);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    error,
    isSuccess,
    executeOperation
  };
}; 