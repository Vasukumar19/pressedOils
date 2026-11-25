'use client'

import Link from 'next/link'

interface ShopErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ShopError({ reset }: ShopErrorProps) {
  return (
    <main className="bg-ivory text-ink flex min-h-[100svh] items-center justify-center px-5 py-24">
      <div className="border-gold/40 bg-champagne/40 max-w-lg border p-8 text-center md:p-12">
        <p className="text-bronze text-xs font-semibold tracking-[0.28em] uppercase">
          Shop unavailable
        </p>
        <h1 className="text-forest mt-4 font-serif text-4xl font-medium">
          We couldn&rsquo;t load the shop catalogue right now.
        </h1>
        <p className="text-sage mt-4 text-sm leading-relaxed">
          Please try again shortly or return to the home page.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => reset()}
            className="bg-forest text-ivory hover:bg-ink min-h-11 px-7 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="border-forest/30 text-forest hover:border-forest flex min-h-11 items-center border px-6 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
          >
            Home page
          </Link>
        </div>
      </div>
    </main>
  )
}
