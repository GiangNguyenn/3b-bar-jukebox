'use client'

import type { JSX } from 'react'
import { useState, Fragment } from 'react'
import { Combobox, Transition } from '@headlessui/react'
import {
  CheckIcon,
  ChevronUpDownIcon,
  XMarkIcon
} from '@heroicons/react/20/solid'
import type { TargetArtist } from '@/services/gameService'
import { POPULAR_TARGET_ARTISTS } from '@/services/gameService'

interface ArtistSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  currentArtist: TargetArtist | null
  onSelect: (artist: TargetArtist) => void
  playerLabel: string
}

export function ArtistSelectionModal({
  isOpen,
  onClose,
  currentArtist,
  onSelect,
  playerLabel
}: ArtistSelectionModalProps): JSX.Element | null {
  const [query, setQuery] = useState('')

  if (!isOpen) {
    return null
  }

  const filteredArtists =
    query === ''
      ? POPULAR_TARGET_ARTISTS
      : POPULAR_TARGET_ARTISTS.filter((artist) =>
          artist.name.toLowerCase().includes(query.toLowerCase())
        )

  const handleSelect = (artist: TargetArtist | null): void => {
    if (artist) {
      onSelect(artist)
      onClose()
      setQuery('')
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      {/* Backdrop */}
      <div
        className='absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity'
        onClick={onClose}
        aria-hidden='true'
      />

      {/* Modal */}
      <div className='pointer-events-auto relative z-50 w-full max-w-md transform transition-all'>
        <div className='rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl'>
          {/* Header */}
          <div className='flex items-center justify-between border-b border-gray-800 px-6 py-4'>
            <h2 className='text-white text-xl font-bold'>
              Select Target Artist for {playerLabel}
            </h2>
            <button
              onClick={onClose}
              className='hover:text-white rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-800'
              aria-label='Close'
            >
              <XMarkIcon className='h-5 w-5' />
            </button>
          </div>

          {/* Search Input */}
          <div className='border-b border-gray-800 px-6 py-4'>
            <Combobox value={null} onChange={handleSelect}>
              <div className='relative'>
                <div className='relative w-full cursor-default overflow-hidden rounded-lg border border-gray-700 bg-gray-800 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 sm:text-sm'>
                  <Combobox.Input
                    className='text-white w-full border-none bg-transparent py-2 pl-3 pr-10 text-sm leading-5 placeholder-gray-400 focus:ring-0'
                    onChange={(event) => setQuery(event.target.value)}
                    displayValue={() => query}
                    placeholder='Search artists...'
                    autoFocus
                  />
                  <Combobox.Button className='absolute inset-y-0 right-0 flex items-center pr-2'>
                    <ChevronUpDownIcon
                      className='h-5 w-5 text-gray-400'
                      aria-hidden='true'
                    />
                  </Combobox.Button>
                </div>
                <Transition
                  as={Fragment}
                  leave='transition ease-in duration-100'
                  leaveFrom='opacity-100'
                  leaveTo='opacity-0'
                  afterLeave={() => setQuery('')}
                >
                  <Combobox.Options className='absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-700 bg-gray-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm'>
                    {filteredArtists.length === 0 && query !== '' ? (
                      <div className='relative cursor-default select-none px-4 py-2 text-gray-400'>
                        No artists found.
                      </div>
                    ) : (
                      filteredArtists.map((artist, index) => (
                        <Combobox.Option
                          key={artist.id ?? `${artist.name}-${index}`}
                          className={({ active }) =>
                            `relative cursor-default select-none py-2 pl-10 pr-4 ${
                              active
                                ? 'bg-green-600/20 text-green-300'
                                : 'text-gray-300'
                            }`
                          }
                          value={artist}
                        >
                          {({ selected, active }) => (
                            <>
                              <span
                                className={`block truncate ${
                                  selected ? 'font-medium' : 'font-normal'
                                }`}
                              >
                                {artist.name}
                              </span>
                              {selected ? (
                                <span
                                  className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                                    active ? 'text-green-300' : 'text-green-400'
                                  }`}
                                >
                                  <CheckIcon
                                    className='h-5 w-5'
                                    aria-hidden='true'
                                  />
                                </span>
                              ) : null}
                            </>
                          )}
                        </Combobox.Option>
                      ))
                    )}
                  </Combobox.Options>
                </Transition>
              </div>
            </Combobox>
          </div>

          {/* Current Artist Info */}
          {currentArtist && (
            <div className='border-b border-gray-800 px-6 py-3'>
              <p className='text-xs text-gray-500'>Current Target Artist:</p>
              <p className='text-sm font-semibold text-gray-300'>
                {currentArtist.name}
              </p>
            </div>
          )}

          {/* Instructions */}
          <div className='px-6 py-3'>
            <p className='text-xs text-gray-500'>
              Search and select a new target artist. You'll score a point when a
              song by this artist plays.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
