'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { usePremiumStatus } from '@/hooks/usePremiumStatus'
import type { Database } from '@/types/supabase'
import type { User } from '@supabase/supabase-js'
import { Loading } from '@/components/ui/loading'
import {
  FaSpotify,
  FaUsers,
  FaChartLine,
  FaPalette,
  FaPlay,
  FaHeadphones,
  FaTrophy
} from 'react-icons/fa'

export default function Home(): JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const {
    isPremium,
    isLoading: isPremiumLoading,
    error: premiumError,
    needsReauth
  } = usePremiumStatus()

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const getUser = async (): Promise<void> => {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }

    void getUser()
  }, [supabase])

  // Redirect non-premium users to premium-required page
  // Only redirect if there's no error and user is confirmed to be non-premium
  useEffect(() => {
    if (
      user &&
      !isPremiumLoading &&
      !isPremium &&
      !premiumError &&
      !needsReauth
    ) {
      void router.push('/premium-required')
    }
  }, [user, isPremium, isPremiumLoading, router, premiumError, needsReauth])

  if (loading || isPremiumLoading) {
    return <Loading fullScreen />
  }

  if (!user) {
    return (
      <div className='min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900'>
        {/* Hero Section */}
        <div className='relative overflow-hidden'>
          <div className='absolute inset-0 bg-gradient-to-r from-green-600/20 to-blue-600/20'></div>

          <div className='relative mx-auto max-w-7xl px-4 pb-16 pt-20 sm:px-6 lg:px-8'>
            <div className='text-center'>
              {/* Main Value Proposition */}

              {/* Main Value Proposition */}
              <div className='mx-auto mb-12 max-w-4xl'>
                <div className='mb-6 inline-block rounded-full bg-yellow-500/20 px-4 py-1 text-sm font-semibold text-yellow-300 backdrop-blur-sm'>
                  Private Beta — Not Currently For Sale
                </div>
                <h1 className='text-white mb-6 text-2xl font-bold md:text-3xl'>
                  Jukebox for Spotify - The Ultimate Shared Playlist Experience
                </h1>
                <p className='text-xl leading-relaxed text-gray-300'>
                  Create the perfect collaborative playlist with our Spotify
                  jukebox. Whether you&apos;re hosting a party with friends or
                  just hanging out, our intelligent jukebox system connects
                  directly to Spotify.
                </p>
                <p className='mt-4 text-lg text-gray-400'>
                  Access represents a private deployment for testing and
                  personal use.
                </p>
              </div>

              {/* CTA Buttons */}
              <div className='mb-16 flex flex-col items-center justify-center gap-4 sm:flex-row'>
                <a
                  href='https://www.offshoresoftware.dev/'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-white inline-flex transform items-center rounded-lg bg-blue-600 px-8 py-4 text-lg font-bold shadow-lg transition-all duration-200 hover:scale-105 hover:bg-blue-700'
                >
                  Contact for Access
                </a>
                <a
                  href='/auth/signin'
                  className='text-white inline-flex transform items-center rounded-lg border border-gray-600 bg-gray-800/50 px-8 py-4 text-lg font-bold shadow-lg backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:bg-gray-700'
                >
                  <FaSpotify className='mr-3 text-xl' />
                  Existing User Sign In
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div className='bg-black/50 py-20'>
          <div className='mx-auto max-w-7xl px-4 sm:px-6 lg:px-8'>
            <div className='mb-16 text-center'>
              <h2 className='text-white mb-4 text-3xl font-bold md:text-4xl'>
                Why Choose Our Spotify Jukebox?
              </h2>
              <p className='text-xl text-gray-300'>
                The most advanced jukebox for Spotify shared playlists and
                collaborative music experiences
              </p>
            </div>

            <div className='grid gap-8 md:grid-cols-2 lg:grid-cols-3'>
              {/* Feature 1 */}
              <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-8 transition-all duration-200 hover:border-green-500'>
                <div className='mb-4 text-green-400'>
                  <FaSpotify className='text-4xl' />
                </div>
                <h3 className='text-white mb-4 text-xl font-bold'>
                  Spotify Integration
                </h3>
                <p className='text-gray-300'>
                  Direct Spotify integration means access to millions of songs
                  for your shared playlist. No more managing local music
                  libraries or dealing with licensing issues. The perfect
                  jukebox for Spotify.
                </p>
              </div>

              {/* Feature 2 */}
              <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-8 transition-all duration-200 hover:border-green-500'>
                <div className='mb-4 text-green-400'>
                  <FaUsers className='text-4xl' />
                </div>
                <h3 className='text-white mb-4 text-xl font-bold'>
                  Collaborative Playlists
                </h3>
                <p className='text-gray-300'>
                  Create the ultimate Spotify shared playlist where everyone
                  contributes. Whether it&apos;s your friends at a party or your
                  roommates at home, everyone gets a say in the music. The best
                  collaborative playlist experience.
                </p>
              </div>

              {/* Feature 3 */}
              <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-8 transition-all duration-200 hover:border-green-500'>
                <div className='mb-4 text-green-400'>
                  <FaPlay className='text-4xl' />
                </div>
                <h4 className='text-white mb-4 text-xl font-bold'>
                  Tune Your Playlist
                </h4>
                <p className='text-gray-300'>
                  Fine-tune your playlist with our intelligent suggestions
                  engine. Discover new songs that match your vibe and keep the
                  perfect atmosphere flowing.
                </p>
              </div>

              {/* Feature 4 */}
              <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-8 transition-all duration-200 hover:border-green-500'>
                <div className='mb-4 text-green-400'>
                  <FaChartLine className='text-4xl' />
                </div>
                <h4 className='text-white mb-4 text-xl font-bold'>
                  Smart Analytics
                </h4>
                <p className='text-gray-300'>
                  Understand what everyone loves. Track popular songs, peak
                  hours, and discover your group&apos;s music taste to create
                  the perfect playlist every time.
                </p>
              </div>

              {/* Feature 5 */}
              <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-8 transition-all duration-200 hover:border-green-500'>
                <div className='mb-4 text-green-400'>
                  <FaPalette className='text-4xl' />
                </div>
                <h4 className='text-white mb-4 text-xl font-bold'>
                  Custom Themes
                </h4>
                <p className='text-gray-300'>
                  Make it yours. Custom colors, themes, and personal touches
                  create a unique experience that matches your style and
                  personality.
                </p>
              </div>

              {/* Feature 6 */}
              <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-8 transition-all duration-200 hover:border-green-500'>
                <div className='mb-4 text-green-400'>
                  <FaHeadphones className='text-4xl' />
                </div>
                <h4 className='text-white mb-4 text-xl font-bold'>
                  Built by Friends, for Friends
                </h4>
                <p className='text-gray-300'>
                  We built this jukebox because we were tired of arguing over
                  what to play while drinking beer together. Now you can easily
                  share your favorite music with friends when hanging out.
                </p>
              </div>

              {/* Feature 7 */}
              <div className='rounded-lg border border-gray-700 bg-gray-800/50 p-8 transition-all duration-200 hover:border-green-500'>
                <div className='mb-4 text-green-400'>
                  <FaTrophy className='text-4xl' />
                </div>
                <h4 className='text-white mb-4 text-xl font-bold'>
                  Competitive Music Game
                </h4>
                <p className='text-gray-300'>
                  Challenge your friends in our innovative music discovery game.
                  Compete to get your favorite artists to play using strategic
                  song selections and intelligent recommendations. The ultimate
                  test of music knowledge and taste.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Pricing Section Removed - Product Not For Sale */}

        {/* Final CTA */}
        <div className='bg-black/50 py-16'>
          <div className='mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8'>
            <h2 className='text-white mb-6 text-3xl font-bold md:text-4xl'>
              Ready to Create the Perfect Spotify Shared Playlist?
            </h2>
            <p className='mb-8 text-xl text-gray-300'>
              Join hundreds of groups and parties already using our Spotify
              jukebox to create unforgettable collaborative playlist
              experiences.
            </p>
            <div className='flex flex-col items-center justify-center gap-4 sm:flex-row'>
              <a
                href='https://www.offshoresoftware.dev/'
                target='_blank'
                rel='noopener noreferrer'
                className='text-white inline-flex transform items-center rounded-lg bg-blue-600 px-8 py-4 text-lg font-bold shadow-lg transition-all duration-200 hover:scale-105 hover:bg-blue-700'
              >
                Contact for Access
              </a>
              <a
                href='/auth/signin'
                className='text-white inline-flex transform items-center rounded-lg border border-gray-600 bg-gray-800/50 px-8 py-4 text-lg font-bold shadow-lg backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:bg-gray-700'
              >
                Sign In
              </a>
            </div>
          </div>
        </div>

        {/* Custom App Development Message */}
        <div className='bg-gray-900/50 py-12'>
          <div className='mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8'>
            <p className='text-lg text-gray-300'>
              Need a custom app like this developed? Contact{' '}
              <a
                href='https://www.offshoresoftware.dev/'
                target='_blank'
                rel='noopener noreferrer'
                className='text-green-400 underline transition-colors hover:text-green-300'
              >
                offshoresoftware.dev
              </a>
            </p>
          </div>
        </div>
      </div>
    )
  }

  // If there's a re-authentication needed, show login button
  if (needsReauth) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
            Spotify Authentication Required
          </h1>
          <p className='mb-8 text-gray-400'>
            Your Spotify connection has expired or is invalid. Please sign in
            again to continue.
          </p>
          <a
            href='/auth/signin'
            className='text-white rounded bg-green-600 px-4 py-2 font-bold hover:bg-green-700'
          >
            Sign In with Spotify
          </a>
        </div>
      </div>
    )
  }

  // If there's a premium error (like token issues), show login button
  if (premiumError) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
            Authentication Issue
          </h1>
          <p className='mb-8 text-gray-400'>
            There was an issue with your Spotify connection. Please sign in
            again.
          </p>
          <a
            href='/auth/signin'
            className='text-white rounded bg-green-600 px-4 py-2 font-bold hover:bg-green-700'
          >
            Sign In Again
          </a>
        </div>
      </div>
    )
  }

  // Don't show admin button if user is not premium
  if (!isPremium) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
            Redirecting...
          </h1>
          <p className='text-gray-400'>
            Please wait while we redirect you to the premium requirements page.
          </p>
        </div>
      </div>
    )
  }

  // Only show admin button for premium users
  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='text-center'>
        <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
          Welcome, {user.email}!
        </h1>
        <p className='mb-8 text-gray-400'>You are signed in successfully.</p>
        <a
          href={`/${user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'user'}/admin`}
          className='text-white rounded bg-blue-500 px-4 py-2 font-bold hover:bg-blue-600'
        >
          Go to Admin
        </a>
      </div>
    </div>
  )
}
