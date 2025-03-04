import { ChangeEvent, FC } from "react";

interface SearchInputProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}

const SearchInput: FC<SearchInputProps> = ({ searchQuery, setSearchQuery }) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <input
      className="search-input"
      type="text"
      value={searchQuery}
      onChange={handleChange}
      placeholder="Search"
      autoFocus
    />
  );
};

export default SearchInput;
