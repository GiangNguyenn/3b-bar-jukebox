"use client";
import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { useEffect, useState } from "react";
import useSearchTracks from "../hooks/useSearchTracks";
import { TrackDetails } from "@/shared/types";
import SearchInput from "@/components/SearchInput";
import useDebounce from "@/hooks/useDebounce";

export default function Home() {
  const { createPlaylist, todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: todayPlaylist } = useGetPlaylist(todayPlaylistId ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([]);

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
        const tracks = await useSearchTracks(debouncedSearchQuery);
        setSearchResults(tracks);
      }
    }

    searchTrackDebounce()
  }, [debouncedSearchQuery]);

  return (
    <div>
      <SearchInput searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      {todayPlaylist && todayPlaylistId ? (
        <div>
          <h1 className="text-3xl font-bold text-center">Today's Playlist</h1>
          <h2 className="text-xl font-semibold text-center">
            {todayPlaylist.name}
          </h2>
          <>
            {todayPlaylist.tracks?.items?.map((track) => (
              <li key={track.track.id}>{track.track.name}</li>
            ))}
          </>
        </div>
      ) : (
        <p>No playlist found.</p>
      )}

      <div>
        <h1 className="text-3xl font-bold text-center">Search Results</h1>
        <ul>
          {searchResults.map((track) => (
            <li key={track.id}>{track.name}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
