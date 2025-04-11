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

interface PlaylistRefreshEvent extends CustomEvent {
  detail: {
    timestamp: number;
  };
}

declare global {
  interface WindowEventMap {
    playlistRefresh: PlaylistRefreshEvent;
  }
}

const Home = memo(() => {
  const {
    createPlaylist,
    fixedPlaylistId,
    isLoading: isCreatingPlaylist,
    isInitialFetchComplete,
  } = useFixedPlaylist();
  const {
    playlist,
    isLoading: isLoadingPlaylist,
    refreshPlaylist,
  } = usePlaylist(fixedPlaylistId ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([]);
  const { searchTracks } = useSearchTracks();

  useEffect(() => {
    (async () => {
      if (!fixedPlaylistId && !isCreatingPlaylist && isInitialFetchComplete) {
        console.log("[Fixed Playlist] Created new playlist");
        await createPlaylist();
      }
    })();
  }, [
    createPlaylist,
    fixedPlaylistId,
    isCreatingPlaylist,
    isInitialFetchComplete,
  ]);

  const handleTrackAdded = useMemo(
    () => async () => {
      // Add a small delay to ensure the track is added to Spotify
      setTimeout(() => {
        console.log("Refreshing playlist after delay...");
        refreshPlaylist().catch((error) => {
          console.error("Error refreshing playlist:", error);
        });
      }, 1000);
    },
    [refreshPlaylist],
  );

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

  const searchInputProps = useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      searchResults,
      setSearchResults,
      playlistId: fixedPlaylistId ?? "",
      onTrackAdded: handleTrackAdded,
    }),
    [searchQuery, searchResults, fixedPlaylistId, handleTrackAdded],
  );

  if (isLoadingPlaylist || !playlist || !fixedPlaylistId) {
    return <Loading />;
  }

  const { tracks } = playlist;

  console.log("[Page] Playlist data:", {
    totalTracks: tracks.total,
    tracksItems: tracks.items,
    tracksItemsLength: tracks.items.length,
  });

  return (
    <div className="items-center justify-items-center space-y-3 p-4 pt-10 font-mono">
      <SearchInput {...searchInputProps} />
      <Playlist tracks={tracks.items} />
    </div>
  );
});

Home.displayName = "Home";

export default Home;
