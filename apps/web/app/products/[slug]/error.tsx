'use client'

import Link from 'next/link'

interface ProductErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ProductError({ reset }: ProductErrorProps) {
  return (
    <main className="bg-ivory text-ink flex min-h-[100svh] items-center justify-center px-5 py-24">
      <div className="border-gold/40 bg-champagne/40 max-w-lg border p-8 text-center md:p-12">
        <p className="text-bronze text-xs font-semibold tracking-[0.28em] uppercase">
          Temporary interruption
        </p>
        <h1 className="text-forest mt-4 font-serif text-4xl font-medium">
          Could not load product details right now.
        </h1>
        <p className="text-sage mt-4 text-sm leading-relaxed">
          Please try again in a few moments or browse our full oil cellar.
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
            href="/shop"
            className="border-forest/30 text-forest hover:border-forest flex min-h-11 items-center border px-6 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
          >
            Back to shop
          </Link>
        </div>
      </div>
    </main>
  )
}
