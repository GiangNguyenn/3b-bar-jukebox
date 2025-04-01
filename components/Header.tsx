"use client";

import React, { useState } from "react";
import Image from "next/image";
import logo from "../app/public/logo.png";

interface ErrorDetails {
  errorMessage?: string;
  status?: number;
  details?: unknown;
}

const Header = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogoClick = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Log environment info
      console.log('Making request from:', {
        environment: process.env.NODE_ENV,
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
        vercelUrl: process.env.VERCEL_URL,
        windowLocation: typeof window !== 'undefined' ? window.location.origin : 'server-side'
      });

      const response = await fetch('/api/refresh-site', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || data.details?.errorMessage || 'Failed to suggest a track');
      }
      
      const data = await response.json();
      console.log('Track suggestion response:', data);
    } catch (error) {
      console.error('Error suggesting track:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to suggest a track';
      setError(errorMessage);
      
      // Log additional error details
      if (error instanceof Error && 'details' in error) {
        const errorDetails = (error as Error & { details: ErrorDetails }).details;
        console.error('Error details:', errorDetails);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-4 p-4">
      <div className="relative cursor-pointer" onClick={handleLogoClick}>
        <Image
          src={logo}
          width={100}
          height={100}
          alt="3B SAIGON JUKEBOX Logo"
          priority
          className={`transition-transform duration-200 hover:scale-105 ${isLoading ? 'animate-spin' : ''}`}
        />
      </div>
      <h1 className="text-4xl text-center text-primary-100 font-[family-name:var(--font-belgrano)] leading-tight">
        3B SAIGON JUKEBOX
      </h1>
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg max-w-md">
          <p className="font-bold">Error:</p>
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
};

export default Header;
