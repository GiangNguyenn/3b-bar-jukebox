/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Used by both `next build` and `next lint`. Without this Next only lints
    // app/, components/, lib/, pages/ and src/, which left most of the source
    // (services, hooks, shared, ...) and every test file unchecked.
    dirs: [
      'app',
      'components',
      'contexts',
      'hooks',
      'lib',
      'recovery',
      'scripts',
      'services',
      'shared',
      'types',
      'utils'
    ]
  },
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
