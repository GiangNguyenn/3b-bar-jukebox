import React from "react";
import Image from "next/image";
import logo from "../app/public/logo.png";

const Header = () => {
  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <Image src={logo} width={100} height={100} alt={""} />
      <h1 className="text-5xl text-center text-primary-100 font-[family-name:var(--font-parklane)]">
        Welcome to 3B Bar Jukebox
      </h1>
    </div>
  );
};

export default Header;
