import { TrackDetails } from "@/shared/types";
import { Autocomplete, AutocompleteItem } from "@heroui/react";
import { FC } from "react";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAddTrackToPlaylist } from "@/hooks/useAddTrackToPlaylist";

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
  const { addTrack } = useAddTrackToPlaylist();
  const handleChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleAddTrack = (trackURI: string) => {
    setSearchResults([]);
    setSearchQuery("");

    addTrack(trackURI)
  };

  return (
    <div className="flex w-8/12 bg-white-500 rounded-lg flex-wrap md:flex-nowrap gap-4">
      <Autocomplete
        aria-label="Search for songs, albums, or artists"
        placeholder="What do you want to listen to?"
        type="text"
        inputValue={searchQuery}
        onInputChange={handleChange}
        selectorIcon={<FontAwesomeIcon icon={faSearch} />}
        disableSelectorIconRotation
        allowsEmptyCollection={false}
      >
        {searchResults.length > 0
          ? searchResults.map((track) => (
              <AutocompleteItem
                key={track.id}
                onPress={() => handleAddTrack(track.uri)}
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
