import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear } from "@fortawesome/free-solid-svg-icons";

export default function Loading() {
  return (
    <div className="relative flex items-center justify-center h-screen bg-[var(--color-bg)]">
      <FontAwesomeIcon className="animate-spin w-16 h-16" icon={faGear} />
    </div>
  );
}
