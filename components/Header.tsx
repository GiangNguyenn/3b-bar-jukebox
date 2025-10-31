'use client'

import React from 'react'
import Image from 'next/image'
import { usePathname } from 'next/navigation'

const Header = (): JSX.Element | null => {
  const pathname = usePathname()

  // Don't show header on public playlist pages or display pages (they have their own branding)
  const isPublicPlaylistPage = pathname.includes('/playlist')
  const isDisplayPage = pathname.includes('/display')

  if (isPublicPlaylistPage || isDisplayPage) {
    return null
  }

  return (
    <div className='flex flex-col items-center justify-center space-y-4 p-4'>
      <div className='relative'>
        <Image
          src='/logo.png'
          width={100}
          height={100}
          alt='3B Jukebox Logo'
          className='transition-transform duration-200 hover:scale-105'
          style={{ width: '100px', height: '100px', objectFit: 'contain' }}
        />
      </div>
      <h1 className='text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
        3B JUKEBOX
      </h1>
    </div>
  )
}

export default Header
