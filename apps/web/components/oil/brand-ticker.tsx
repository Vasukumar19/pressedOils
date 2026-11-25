import { TICKER } from '@/lib/content'

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <ul aria-hidden={hidden} className="flex shrink-0 items-center">
      {TICKER.map((item) => (
        <li key={item} className="flex items-center">
          <span className="text-ink px-8 font-serif text-3xl font-medium tracking-[0.12em] whitespace-nowrap uppercase md:px-12 md:text-5xl">
            {item}
          </span>
          <svg aria-hidden viewBox="0 0 12 12" className="text-bronze size-3 shrink-0">
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
      className="border-gold/30 bg-champagne overflow-hidden border-y py-8 md:py-10"
    >
      <div className="animate-marquee flex w-max hover:[animation-play-state:paused]">
        <Row />
        <Row hidden />
      </div>
    </section>
  )
}
