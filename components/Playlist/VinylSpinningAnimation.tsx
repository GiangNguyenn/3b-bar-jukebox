import React from "react";

interface IVinylSpinningAnimationProps {
  is_playing: boolean;
  albumCover?: string;
}

const VinylSpinningAnimation: React.FC<IVinylSpinningAnimationProps> = ({
  is_playing,
  albumCover,
}) => {
  return (
    <div className="relative flex items-center justify-center p-2">
      {/* <div
        className={`absolute top-2 right-4 transform transition-transform duration-700 ${
          is_playing ? "translate-x-3 -rotate-30" : "translate-x-10 rotate-0"
        }`}
      >
        <div className="w-16 h-1 bg-gray-700"></div>
        <div className="w-3 h-3 bg-gray-800 rounded-full mt-1"></div>
      </div> */}
      <div
        className={`relative w-32 h-32 rounded-full border-8 border-gray-800 bg-black shadow-lg ${
          is_playing ? "animate-spinSlow" : ""
        }`}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full border-4 border-gray-900 bg-black"></div>
        </div>

        {albumCover && (
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src={albumCover}
              alt="Album Cover"
              className="w-20 h-20 rounded-full object-cover border-2 border-gray-800"
            />
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 bg-gray-600 rounded-full"></div>
        </div>
      </div>
    </div>
  );
};

export default VinylSpinningAnimation;
