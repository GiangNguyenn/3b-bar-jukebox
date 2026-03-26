'use client'

import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface SubtitleOverlayProps {
  text: string | null
  isVisible: boolean
}

export function SubtitleOverlay({
  text,
  isVisible
}: SubtitleOverlayProps): React.ReactElement | null {
  return (
    <AnimatePresence>
      {isVisible && text && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className='fixed inset-0 z-50 flex items-center justify-center px-8'
        >
          <div className='max-w-5xl rounded-xl bg-black/70 px-10 py-6'>
            <p
              className='text-white text-center text-5xl font-medium leading-tight'
              style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
            >
              {text}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
