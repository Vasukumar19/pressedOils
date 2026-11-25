import { LABEL_CHECKLIST, LABEL_TERMS } from '@/lib/content'
import { Eyebrow, MaskLines } from './primitives'

export function LabelGuide() {
  return (
    <section className="bg-champagne text-ink py-24 md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <Eyebrow tone="dark">06 / A small guide</Eyebrow>
        <h2 className="mt-8 max-w-4xl text-[clamp(2.75rem,6vw,5.5rem)] leading-[1]">
          <MaskLines
            lines={[
              'Read the label,',
              <em key="n" className="text-bronze">
                not just the promise.
              </em>,
            ]}
          />
        </h2>

        <div className="mt-16 grid gap-12 md:mt-24 lg:grid-cols-12 lg:gap-16">
          <dl data-stagger="0.12" className="lg:col-span-7">
            {LABEL_TERMS.map((item, i) => (
              <div
                key={item.term}
                className="border-gold/35 grid gap-3 border-t py-8 md:grid-cols-[auto_1fr] md:gap-10"
              >
                <dt className="flex items-baseline gap-4 md:w-72">
                  <span className="text-bronze font-mono text-xs">0{i + 1}</span>
                  <span className="font-serif text-3xl font-medium italic md:text-4xl">
                    {item.term}
                  </span>
                </dt>
                <dd className="text-ink/75 max-w-md text-[15px] leading-relaxed md:pt-2">
                  {item.body}
                </dd>
              </div>
            ))}
            <div className="border-gold/35 border-t" />
          </dl>

          <div data-reveal className="lg:col-span-5">
            <div className="bg-ivory text-forest relative p-8 md:p-10">
              <div
                aria-hidden
                className="border-gold pointer-events-none absolute inset-3 border"
              />
              <p className="text-sage relative text-xs font-semibold tracking-[0.28em] uppercase">
                On any bottle
              </p>
              <p className="relative mt-6 font-serif text-3xl leading-snug font-medium md:text-[2.15rem]">
                Look for{' '}
                {LABEL_CHECKLIST.map((item, i) => (
                  <span key={item}>
                    <em className="bg-gold/25 px-1 not-italic">{item}</em>
                    {i < LABEL_CHECKLIST.length - 2
                      ? ', '
                      : i === LABEL_CHECKLIST.length - 2
                        ? ' and '
                        : '.'}
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
