export default function AdminPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      {/* Construction banner */}
      <div className="border-gold/40 bg-champagne text-bronze inline-flex items-center gap-3 border px-6 py-3 text-xs font-semibold tracking-[0.22em] uppercase">
        <span aria-hidden className="h-px w-6 bg-current opacity-60" />
        Coming in Phase 9
        <span aria-hidden className="h-px w-6 bg-current opacity-60" />
      </div>

      <h1 className="text-forest font-serif text-[clamp(2.5rem,6vw,4.5rem)] leading-none">Admin</h1>

      <p className="text-sage max-w-sm text-base leading-relaxed">
        The owner dashboard is not yet built. It will be added in Phase 9 of the development plan.
      </p>

      <a
        href="http://localhost:3000"
        className="border-forest/30 text-forest hover:border-forest hover:bg-forest hover:text-ivory mt-4 inline-flex min-h-11 items-center border px-7 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
      >
        Back to storefront
      </a>
    </main>
  )
}
