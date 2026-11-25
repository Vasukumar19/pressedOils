import Link from 'next/link'

export default function ProductNotFound() {
  return (
    <main className="bg-ivory text-ink flex min-h-[100svh] items-center justify-center px-5 py-24">
      <div className="border-gold/40 bg-champagne/40 max-w-lg border p-8 text-center md:p-12">
        <p className="text-bronze text-xs font-semibold tracking-[0.28em] uppercase">404</p>
        <h1 className="text-forest mt-4 font-serif text-4xl font-medium">
          We couldn&rsquo;t find that oil.
        </h1>
        <p className="text-sage mt-4 text-sm leading-relaxed">
          This bottle may be out of season or the link may have moved. Explore our current
          cold-pressed oils in the shop.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/shop"
            className="bg-forest text-ivory hover:bg-ink inline-flex min-h-11 items-center px-7 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
          >
            Browse full shop
          </Link>
          <Link
            href="/"
            className="border-forest/30 text-forest hover:border-forest inline-flex min-h-11 items-center border px-6 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
          >
            Home page
          </Link>
        </div>
      </div>
    </main>
  )
}
