import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Admin Dashboard',
}

export default function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>): JSX.Element {
  return (
    <div className="min-h-screen bg-black">
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
