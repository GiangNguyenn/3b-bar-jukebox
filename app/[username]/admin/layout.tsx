import { Metadata } from 'next'
import { ProtectedRoute } from './components/ProtectedRoute'

export const metadata: Metadata = {
  metadataBase: new URL('https://jukebox.beer'),
  title: 'Admin Dashboard'
}

export default function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>): JSX.Element {
  return (
    <ProtectedRoute>
      <div className='min-h-screen bg-black'>
        <main className='container mx-auto px-4 py-8'>{children}</main>
      </div>
    </ProtectedRoute>
  )
}
