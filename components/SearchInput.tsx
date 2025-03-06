import { SpotifyPlaylistItem, TrackDetails } from "@/shared/types";
import { Autocomplete, AutocompleteItem } from "@heroui/react";
import { FC } from "react";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { sendApiRequest } from "@/shared/api";

interface SearchInputProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: TrackDetails[];
  setSearchResults: (value: TrackDetails[]) => void;
  todayPlaylistId: string;
}

const SearchInput: FC<SearchInputProps> = ({
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
  todayPlaylistId,
}) => {
  const handleChange = (value: string) => {
    setSearchQuery(value);
  };

  const addTrackToPlaylist = async (trackURI: string) => {
    setSearchResults([]);
    setSearchQuery("");
    await sendApiRequest<SpotifyPlaylistItem>({
      path: `playlists/${todayPlaylistId}/tracks`,
      method: "POST",
      body: JSON.stringify({
        uris: [trackURI],
      }),
    });
  };

  return (
    <div className="flex w-8/12 flex-wrap md:flex-nowrap gap-4">
      <Autocomplete
        aria-label="Search for songs, albums, or artists"
        placeholder="What do you want to listen to?"
        type="text"
        inputValue={searchQuery}
        onInputChange={handleChange}
        selectorIcon={<FontAwesomeIcon icon={faSearch} />}
        disableSelectorIconRotation
      >
        {searchResults.length > 0
          ? searchResults.map((track) => (
              <AutocompleteItem
                key={track.id}
                onPress={() => addTrackToPlaylist(track.uri)}
              >
                {track.name}
              </AutocompleteItem>
            ))
          : null}
      </Autocomplete>
    </div>
  );
};

export default SearchInput;
