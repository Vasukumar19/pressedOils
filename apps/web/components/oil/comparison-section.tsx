import { COMPARE_COLUMNS, COMPARE_NOTE, COMPARE_ROWS } from '@/lib/content'
import { Eyebrow, MaskLines } from './primitives'

export function ComparisonSection() {
  return (
    <section id="why" className="bg-ivory py-24 md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <Eyebrow>01 / A different kind of everyday</Eyebrow>
        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-end">
          <h2 className="text-forest text-[clamp(2.5rem,5.6vw,5.25rem)] leading-[1] lg:col-span-8">
            <MaskLines
              lines={[
                'Most cooking oil is built',
                <>
                  for <em>low cost</em> and
                </>,
                'long shelf life.',
              ]}
            />
          </h2>
          <p
            data-reveal
            className="text-sage max-w-sm text-lg leading-relaxed lg:col-span-4 lg:pb-3"
          >
            There is a place for every oil. What matters is knowing how yours was made.
          </p>
        </div>

        <div className="mt-16 md:mt-24">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-forest text-xs font-semibold tracking-[0.28em] uppercase">Compare</p>
            <p className="text-sage text-xs tracking-[0.2em] uppercase lg:hidden">
              Swipe to compare →
            </p>
          </div>

          <div className="no-scrollbar -mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
            <div
              role="table"
              aria-label="Refined, palm and cold pressed oil compared"
              className="min-w-[760px]"
            >
              <div data-stagger="0.09">
                <div role="row" className="grid grid-cols-[1fr_1.1fr_1.1fr_1.25fr] items-end">
                  <div role="columnheader" className="bg-ivory sticky left-0 z-10 py-5 pr-4">
                    <span className="sr-only">Feature</span>
                  </div>
                  {COMPARE_COLUMNS.map((col, i) => (
                    <div
                      key={col}
                      role="columnheader"
                      className={
                        i === 2
                          ? 'border-gold/60 bg-champagne text-bronze border-x border-t px-6 pt-8 pb-5 font-serif text-3xl font-medium italic md:text-4xl'
                          : 'text-forest px-6 py-5 font-serif text-2xl font-medium md:text-3xl'
                      }
                    >
                      {col}
                    </div>
                  ))}
                </div>
                {COMPARE_ROWS.map((row, r) => (
                  <div
                    key={row.label}
                    role="row"
                    className="border-forest/15 grid grid-cols-[1fr_1.1fr_1.1fr_1.25fr] border-t"
                  >
                    <div
                      role="rowheader"
                      className="bg-ivory text-forest sticky left-0 z-10 py-6 pr-4 text-xs font-semibold tracking-[0.22em] uppercase"
                    >
                      {row.label}
                    </div>
                    {row.cells.map((cell, i) => (
                      <div
                        key={i}
                        role="cell"
                        className={
                          i === 2
                            ? `border-gold/60 bg-champagne text-forest border-x px-6 py-6 text-[15px] font-medium ${r === COMPARE_ROWS.length - 1 ? 'border-b' : ''} ${r === COMPARE_ROWS.length - 1 ? 'pb-9' : ''}`
                            : 'text-sage px-6 py-6 text-[15px]'
                        }
                      >
                        {cell}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p data-reveal className="text-sage mt-8 max-w-3xl text-sm leading-relaxed">
            {COMPARE_NOTE}
          </p>
        </div>
      </div>
    </section>
  )
}
