import { useState, useEffect } from 'react';

interface UseArtistExtractReturn {
  data: string | null;
  isLoading: boolean;
  error: Error | null;
}

export const useArtistExtract = (artistName: string | undefined): UseArtistExtractReturn => {
  const [data, setData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!artistName) {
      setData(null);
      return;
    }

    // Immediately clear previous data and set loading state
    setData(null);
    setError(null);
    setIsLoading(true);

    const fetchData = async () => {
      try {
        const response = await fetch(`/api/artist-extract?artistName=${encodeURIComponent(artistName)}`);
        if (response.status === 404) {
          // Artist or extract not found, handled gracefully by keeping data null
          return;
        }
        if (!response.ok) {
          throw new Error('Failed to fetch artist extract');
        }
        const result = await response.json();
        setData(result.extract);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('An unknown error occurred'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [artistName]);

  return { data, isLoading, error };
};