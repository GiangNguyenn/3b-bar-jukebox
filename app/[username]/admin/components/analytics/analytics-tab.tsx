'use client';

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Loading } from '@/components/ui/loading';
import { ErrorMessage } from '@/components/ui/error-message';
import { type Database } from '@/types/supabase';
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist';
import { SpotifyApiService } from '@/services/spotifyApi';
import { showToast } from '@/lib/toast';

interface TopTrack {
  count: number;
  name: string;
  artist: string;
  spotify_track_id: string;
}

const useTopTracks = () => {
  const [tracks, setTracks] = useState<TopTrack[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClientComponentClient<Database>();

  useEffect(() => {
    const fetchTopTracks = async (): Promise<void> => {
      try {
        setIsLoading(true);
        const { data: rawData, error } = await supabase
          .from('suggested_tracks')
          .select('count, tracks(name, artist, spotify_track_id)')
          .order('count', { ascending: false })
          .limit(10);

        if (error) {
          throw new Error(error.message);
        }

        if (rawData) {
          const formattedTracks = rawData
            .map((item) => {
              // Supabase returns the joined table as an array, even for a many-to-one relationship.
              // We need to handle the case where `tracks` is an array and access the first element.
              const trackData = Array.isArray(item.tracks) ? item.tracks[0] : item.tracks;
              if (!trackData) {
                return null;
              }
              return {
                count: item.count,
                name: trackData.name,
                artist: trackData.artist,
                spotify_track_id: trackData.spotify_track_id,
              };
            })
            .filter((track): track is TopTrack => track !== null);
          setTracks(formattedTracks);
        } else {
          setTracks([]);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'An unknown error occurred'
        );
      } finally {
        setIsLoading(false);
      }
    };

    void fetchTopTracks();
  }, [supabase]);

  return { tracks, isLoading, error };
};

export const AnalyticsTab = (): JSX.Element => {
  const { tracks, isLoading, error } = useTopTracks();
  const { fixedPlaylistId } = useFixedPlaylist();
  const [isAdding, setIsAdding] = useState(false);

  const handleAddToPlaylist = async () => {
    setIsAdding(true);
    try {
      const trackUris = tracks.map(
        (track) => `spotify:track:${track.spotify_track_id}`
      );

      if (!fixedPlaylistId) {
        showToast('No fixed playlist is set.', 'warning');
        return;
      }

      if (trackUris.length === 0) {
        showToast('No tracks to add.', 'warning');
        return;
      }

      await SpotifyApiService.getInstance().addItemsToPlaylist(
        fixedPlaylistId,
        trackUris
      );
      showToast('Tracks added to playlist successfully!', 'success');
    } catch (error) {
      showToast('Failed to add tracks to playlist.', 'warning');
      console.error(error);
    } finally {
      setIsAdding(false);
    }
  };

  if (isLoading) {
    return <Loading message="Loading top tracks..." />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Top 10 Suggested Tracks</h2>
        <button
          onClick={handleAddToPlaylist}
          disabled={isLoading || isAdding || tracks.length === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
        >
          {isAdding ? 'Adding...' : 'Add to playlist'}
        </button>
      </div>
      {tracks.length === 0 ? (
        <p>No tracks have been suggested yet.</p>
      ) : (
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="py-2 px-4 border-b text-left">Count</th>
              <th className="py-2 px-4 border-b text-left">Track</th>
              <th className="py-2 px-4 border-b text-left">Artist</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, index) => (
              <tr key={index}>
                <td className="py-2 px-4 border-b text-center">{track.count}</td>
                <td className="py-2 px-4 border-b">{track.name}</td>
                <td className="py-2 px-4 border-b">{track.artist}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};