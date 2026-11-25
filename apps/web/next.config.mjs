/** @type {import('next').NextConfig} */
const isProd = process.env.APP_ENV === 'production' || process.env.VERCEL_ENV === 'production'

const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    if (!isProd) return { beforeFiles: [], afterFiles: [], fallback: [] }
    return {
      beforeFiles: [
        {
          source: '/placeholders/:path*',
          destination: '/_not-found',
        },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
}

export default nextConfig
