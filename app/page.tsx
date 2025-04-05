"use client";
import { useFixedPlaylist } from "@/hooks/useFixedPlaylist";
import { usePlaylist } from "@/hooks/usePlaylist";
import { useEffect, useState, useMemo, memo } from "react";
import useSearchTracks from "../hooks/useSearchTracks";
import { TrackDetails } from "@/shared/types";
import Playlist from "@/components/Playlist/Playlist";
import Loading from "./loading";
import SearchInput from "@/components/SearchInput";
import { useDebounce } from "use-debounce";
import { useMyPlaylists } from "@/hooks/useMyPlaylists";

interface PlaylistRefreshEvent extends CustomEvent {
  detail: {
    timestamp: number;
  };
}

declare global {
  interface WindowEventMap {
    'playlistRefresh': PlaylistRefreshEvent;
  }
}

const Home = memo(() => {
  const { createPlaylist, todayPlaylistId, isLoading: isCreatingPlaylist, isInitialFetchComplete } = useFixedPlaylist();
  const { playlist, isLoading: isLoadingPlaylist, refreshPlaylist } = usePlaylist(todayPlaylistId ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([]);
  const { searchTracks } = useSearchTracks();
  const { data: playlists } = useMyPlaylists();

  useEffect(() => {
    (async () => {
      if (!todayPlaylistId && !isCreatingPlaylist && isInitialFetchComplete) {
        console.log('[Page] Creating new playlist - conditions:', {
          noPlaylistId: !todayPlaylistId,
          notCreating: !isCreatingPlaylist,
          initialFetchComplete: isInitialFetchComplete
        });
        await createPlaylist();
      }
    })();
  }, [createPlaylist, todayPlaylistId, isCreatingPlaylist, isInitialFetchComplete]);

  const handleTrackAdded = useMemo(() => async () => {
    // Add a small delay to ensure the track is added to Spotify
    setTimeout(() => {
      console.log('Refreshing playlist after delay...');
      refreshPlaylist().catch(error => {
        console.error('Error refreshing playlist:', error);
      });
    }, 1000);
  }, [refreshPlaylist]);

  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);

  useEffect(() => {
    const searchTrackDebounce = async () => {
      if (debouncedSearchQuery !== "") {
        const tracks = await searchTracks(debouncedSearchQuery);
        setSearchResults(tracks);
      } else {
        setSearchResults([]);
      }
    };

    searchTrackDebounce();
  }, [debouncedSearchQuery, searchTracks]);

  const searchInputProps = useMemo(() => ({
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    playlistId: todayPlaylistId ?? "",
    onTrackAdded: handleTrackAdded
  }), [searchQuery, searchResults, todayPlaylistId, handleTrackAdded]);

  if (isLoadingPlaylist || !playlist || !todayPlaylistId) {
    return <Loading />;
  }

  const { tracks } = playlist;

  console.log('[Page] Playlist data:', {
    totalTracks: tracks.total,
    tracksItems: tracks.items,
    tracksItemsLength: tracks.items.length
  });

  return (
    <div className="items-center justify-items-center space-y-3 p-4 pt-10 font-mono">
      <SearchInput {...searchInputProps} />
      <Playlist tracks={tracks.items} />
    </div>
  );
});

Home.displayName = 'Home';

export default Home;
