"use client";
import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { Suspense, useEffect, useState } from "react";
import { useSearchTracks } from "../hooks/useSearchTracks";
import { TrackDetails } from "@/shared/types";
import Search from "@/components/Search";
import { Playlist } from "@/components/Playlist/Playlist";
import Loading from "./loading";

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

  const onSearchQueryChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const onSearch = async () => {
    try {
      const tracks = await searchTracks(searchQuery);
      setSearchResults(tracks);
    } catch (error) {
      console.error("Error searching tracks:", error);
    }
  };

  if (isLoading || !todayPlaylist || !todayPlaylistId) {
    return <Loading />;
  }

  const { tracks, name } = todayPlaylist!!;

  return (
    <div className="items-center justify-items-center p-4 pt-10 font-mono">
        <h1 className="text-3xl text-center font-[family-name:var(--font-parklane)]">
          {name}
        </h1>
        <Playlist tracks={tracks.items} />
    </div>
  );
}
