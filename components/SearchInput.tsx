import { TrackDetails } from "@/shared/types";
import { Autocomplete, AutocompleteItem } from "@heroui/react";
import { FC } from "react";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

interface SearchInputProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: TrackDetails[];
  setSearchResults: (value: TrackDetails[]) => void;
}

const SearchInput: FC<SearchInputProps> = ({
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
}) => {
  const handleChange = (value: string) => {
    setSearchQuery(value);
  };

  const addTrackToPlaylist = (track: TrackDetails) => {
    // call api to add track to playlist

    setSearchResults([]);
    setSearchQuery("");
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
              <AutocompleteItem key={track.id} onPress={() => addTrackToPlaylist(track)}>
                {track.name}
              </AutocompleteItem>
            ))
          : null}
      </Autocomplete>
    </div>
  );
};

export default SearchInput;
