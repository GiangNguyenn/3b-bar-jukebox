"use client";
import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { useEffect, useState } from "react";
import useSearchTracks from "../hooks/useSearchTracks";
import { TrackDetails } from "@/shared/types";
import { Playlist } from "@/components/Playlist/Playlist";
import Loading from "./loading";
import SearchInput from "@/components/SearchInput";
import { useDebounce } from "use-debounce";
import { cleanupOldPlaylists } from "@/services/playlist";
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

export default function Home() {
  const { createPlaylist, todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: todayPlaylist, isLoading, refetchPlaylist } = useGetPlaylist(
    todayPlaylistId ?? ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([]);
  const { searchTracks } = useSearchTracks();
  const { data: playlists } = useMyPlaylists();
  
  // Handle cleanup of old playlists
  useEffect(() => {
    if (playlists?.items) {
      cleanupOldPlaylists(playlists.items).catch(console.error);
    }
  }, [playlists?.items]);

  useEffect(() => {
    (async () => {
      if (!todayPlaylistId) {
        await createPlaylist();
      }
    })();
  }, [createPlaylist, todayPlaylistId]);

  // Listen for playlist refresh events
  useEffect(() => {
    const handlePlaylistRefresh = (event: PlaylistRefreshEvent) => {
      console.log('Refreshing playlist...', event.detail.timestamp);
      refetchPlaylist();
    };

    window.addEventListener('playlistRefresh', handlePlaylistRefresh);
    return () => {
      window.removeEventListener('playlistRefresh', handlePlaylistRefresh);
    };
  }, [refetchPlaylist]);

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

  if (isLoading || !todayPlaylist || !todayPlaylistId) {
    return <Loading />;
  }

  const { tracks, name } = todayPlaylist!;

  return (
    <div className="items-center justify-items-center space-y-3 p-4 pt-10 font-mono">
      <SearchInput
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        setSearchResults={setSearchResults}
      />
      <h1 className="lg:text-3xl md:text-2xl sm:text-base text-center text-primary-200 font-[family-name:var(--font-parklane)] break-words">
        {name}
      </h1>
      <Playlist tracks={tracks.items} />
    </div>
  );
}
