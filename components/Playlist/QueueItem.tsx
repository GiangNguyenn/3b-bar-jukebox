import { TrackItem } from "@/shared/types";
import React, { FC } from "react";
import Image from "next/image";

interface IQueueItemProps {
  track: TrackItem;
}

const QueueItem: FC<IQueueItemProps> = ({ track }) => {
  const {
    track: {
      name,
      album: { images },
      artists,
    },
  } = track;

  return (
    <div className="flex border-b py-3 cursor-pointer hover:shadow-md px-2 ">
      <Image
        className="rounded-lg"
        alt="Album cover"
        src={images[0].url}
        width={40}
        height={40}
        style={{ objectFit: 'cover' }}
      />
      <div className="flex flex-col px-2 w-full">
        <span className="text-sm text-secondary-500 capitalize font-semibold pt-1">
          {name}
        </span>
        <span className="text-xs text-gray-500 uppercase font-medium ">
          -{artists.map((artist) => artist.name).join(", ")}
        </span>
      </div>
    </div>
  );
};

export default QueueItem;
