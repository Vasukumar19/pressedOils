import { LABEL_CHECKLIST, LABEL_TERMS } from '@/lib/content'
import { Eyebrow, MaskLines } from './primitives'

export function LabelGuide() {
  return (
    <section className="bg-champagne py-24 text-ink md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <Eyebrow tone="dark">06 / A small guide</Eyebrow>
        <h2 className="mt-8 max-w-4xl text-[clamp(2.75rem,6vw,5.5rem)] leading-[1]">
          <MaskLines
            lines={['Read the label,', <em key="n" className="text-bronze">not just the promise.</em>]}
          />
        </h2>

        <div className="mt-16 grid gap-12 md:mt-24 lg:grid-cols-12 lg:gap-16">
          <dl data-stagger="0.12" className="lg:col-span-7">
            {LABEL_TERMS.map((item, i) => (
              <div key={item.term} className="grid gap-3 border-t border-gold/35 py-8 md:grid-cols-[auto_1fr] md:gap-10">
                <dt className="flex items-baseline gap-4 md:w-72">
                  <span className="font-mono text-xs text-bronze">0{i + 1}</span>
                  <span className="font-serif font-medium text-3xl italic md:text-4xl">{item.term}</span>
                </dt>
                <dd className="max-w-md text-[15px] leading-relaxed text-ink/75 md:pt-2">{item.body}</dd>
              </div>
            ))}
            <div className="border-t border-gold/35" />
          </dl>

          <div data-reveal className="lg:col-span-5">
            <div className="relative bg-ivory p-8 text-forest md:p-10">
              <div aria-hidden className="pointer-events-none absolute inset-3 border border-gold" />
              <p className="relative text-xs font-semibold uppercase tracking-[0.28em] text-sage">
                On any bottle
              </p>
              <p className="relative mt-6 font-serif font-medium text-3xl leading-snug md:text-[2.15rem]">
                Look for{' '}
                {LABEL_CHECKLIST.map((item, i) => (
                  <span key={item}>
                    <em className="bg-gold/25 px-1 not-italic">{item}</em>
                    {i < LABEL_CHECKLIST.length - 2 ? ', ' : i === LABEL_CHECKLIST.length - 2 ? ' and ' : '.'}
                  </span>
                ))}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
