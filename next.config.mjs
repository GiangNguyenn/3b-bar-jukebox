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
  serverExternalPackages: [],
  webpack: (config) => {
    config.ignoreWarnings = [{ module: /node_modules\/@supabase\/realtime-js/ }]
    return config
  }
}

export default nextConfig
