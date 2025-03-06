"use client";
import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { useEffect, useState } from "react";
import useSearchTracks from "../hooks/useSearchTracks";
import { TrackDetails } from "@/shared/types";
import { Playlist } from "@/components/Playlist/Playlist";
import Loading from "./loading";
import useDebounce from "@/hooks/useDebounce";
import SearchInput from "@/components/SearchInput";

export default function Home() {
  const { createPlaylist, todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: todayPlaylist, isLoading } = useGetPlaylist(
    todayPlaylistId ?? ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [searchResults,setSearchResults] = useState<TrackDetails[]>([]);
  const { searchTracks } = useSearchTracks();

  useEffect(() => {
    (async () => {
      if (!todayPlaylistId) {
        await createPlaylist();
      }
    })();
  }, [createPlaylist]);

  const debouncedSearchQuery = useDebounce(searchQuery);

  useEffect(() => {
    const searchTrackDebounce = async () => {
      if (debouncedSearchQuery !== "") {
        const tracks = await searchTracks(debouncedSearchQuery);
        setSearchResults(tracks);
      }
    };

    searchTrackDebounce();
  }, [debouncedSearchQuery]);

  if (isLoading || !todayPlaylist || !todayPlaylistId) {
    return <Loading />;
  }

  const { tracks, name } = todayPlaylist!;

  return (
    <div className="items-center justify-items-center p-4 pt-10 font-mono">
      <SearchInput searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      <h1 className="text-3xl text-center font-[family-name:var(--font-parklane)]">
        {name}
      </h1>
      <Playlist tracks={tracks.items} />
    </div>
  );
}
