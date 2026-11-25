import type { Metadata } from 'next'
import { Inter, Cormorant_Garamond } from 'next/font/google'
import { shouldShowSampleDataBanner } from '@pressedoils/shared'
import './globals.css'

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-cormorant',
  display: 'swap',
})

export const metadata: Metadata = {
  title: '[YOUR BRAND] Admin',
  description: 'Internal admin dashboard — not publicly accessible.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const showSampleBanner = shouldShowSampleDataBanner({
    APP_ENV: process.env.APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    IS_PRODUCTION_DB: process.env.IS_PRODUCTION_DB,
    SHOW_SAMPLE_DATA_BANNER: process.env.SHOW_SAMPLE_DATA_BANNER,
  })

  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body className="bg-ivory text-ink antialiased">
        {showSampleBanner ? (
          <div
            role="status"
            className="bg-champagne border-gold/40 text-ink border-b px-4 py-2 text-center text-xs"
          >
            <span className="text-bronze mr-2 text-[10px] font-medium tracking-[0.18em] uppercase">
              Preview Mode
            </span>
            Sample database seed active — not connected to production inventory.
          </div>
        ) : null}
        {children}
      </body>
    </html>
  )
}
