/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.scdn.co',
        pathname: '/**'
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/**'
      }
    ]
  },
  // Increase API route timeout for complex game operations
  experimental: {
    serverComponentsExternalPackages: []
  },
  // Vercel-specific configuration
  ...(process.env.VERCEL
    ? {
        functions: {
          'app/api/game/init-round/route.ts': {
            maxDuration: 30 // 30 seconds for Pro plan
          }
        }
      }
    : {})
  // async rewrites() {
  //   return [
  //     {
  //       source: '/api/auth/:path*',
  //       destination: '/api/auth'
  //     }
  //   ]
  // }
}

export default nextConfig
