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

export default function Home() {
  const { createPlaylist, todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: todayPlaylist, isLoading } = useGetPlaylist(
    todayPlaylistId ?? ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([]);
  const { searchTracks } = useSearchTracks();

  useEffect(() => {
    (async () => {
      if (!todayPlaylistId) {
        await createPlaylist();
      }
    })();
  }, [createPlaylist]);

  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);

  useEffect(() => {
    const searchTrackDebounce = async () => {
      if (debouncedSearchQuery !== "") {
        const tracks = await searchTracks(debouncedSearchQuery);
        setSearchResults(tracks);
      } else {
        setSearchResults([])
      }
    };

    searchTrackDebounce();
  }, [debouncedSearchQuery]);

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
      <h1 className="text-3xl text-center font-[family-name:var(--font-parklane)]">
        {name}
      </h1>
      <Playlist tracks={tracks.items} />
    </div>
  );
}
