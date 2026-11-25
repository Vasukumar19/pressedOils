import { NextResponse, type NextRequest } from 'next/server'

function isProductionRuntime() {
  return process.env.APP_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

/**
 * Blocks /placeholders/* in production builds/deployments so dev/staging
 * placeholder assets are never served to live customers.
 */
export function proxy(request: NextRequest) {
  if (isProductionRuntime() && request.nextUrl.pathname.startsWith('/placeholders/')) {
    return new NextResponse(null, { status: 404 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/placeholders/:path*',
}
