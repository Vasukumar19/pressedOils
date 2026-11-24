import { TICKER } from '@/lib/content'

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <ul aria-hidden={hidden} className="flex shrink-0 items-center">
      {TICKER.map((item) => (
        <li key={item} className="flex items-center">
          <span className="whitespace-nowrap px-8 font-serif font-medium text-3xl uppercase tracking-[0.12em] text-ink md:px-12 md:text-5xl">
            {item}
          </span>
          <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 text-bronze">
            <path d="M6 0 12 6 6 12 0 6Z" fill="currentColor" />
          </svg>
        </li>
      ))}
    </ul>
  )
}

export function BrandTicker() {
  return (
    <section
      aria-label="What we promise"
      className="overflow-hidden border-y border-gold/30 bg-champagne py-8 md:py-10"
    >
      <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
        <Row />
        <Row hidden />
      </div>
    </section>
  )
}
