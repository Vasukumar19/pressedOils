import { COMPARE_COLUMNS, COMPARE_NOTE, COMPARE_ROWS } from '@/lib/content'
import { Eyebrow, MaskLines } from './primitives'

export function ComparisonSection() {
  return (
    <section id="why" className="bg-ivory py-24 md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <Eyebrow>01 / A different kind of everyday</Eyebrow>
        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-end">
          <h2 className="text-[clamp(2.5rem,5.6vw,5.25rem)] leading-[1] text-forest lg:col-span-8">
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
          <p data-reveal className="max-w-sm text-lg leading-relaxed text-sage lg:col-span-4 lg:pb-3">
            There is a place for every oil. What matters is knowing how yours was made.
          </p>
        </div>

        <div className="mt-16 md:mt-24">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-forest">Compare</p>
            <p className="text-xs uppercase tracking-[0.2em] text-sage lg:hidden">Swipe to compare →</p>
          </div>

          <div className="no-scrollbar -mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
            <div role="table" aria-label="Refined, palm and cold pressed oil compared" className="min-w-[760px]">
              <div data-stagger="0.09">
                <div
                  role="row"
                  className="grid grid-cols-[1fr_1.1fr_1.1fr_1.25fr] items-end"
                >
                  <div role="columnheader" className="sticky left-0 z-10 bg-ivory py-5 pr-4">
                    <span className="sr-only">Feature</span>
                  </div>
                  {COMPARE_COLUMNS.map((col, i) => (
                    <div
                      key={col}
                      role="columnheader"
                      className={
                        i === 2
                          ? 'border-x border-t border-gold/60 bg-champagne px-6 pb-5 pt-8 font-serif font-medium text-3xl italic text-bronze md:text-4xl'
                          : 'px-6 py-5 font-serif font-medium text-2xl text-forest md:text-3xl'
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
                    className="grid grid-cols-[1fr_1.1fr_1.1fr_1.25fr] border-t border-forest/15"
                  >
                    <div
                      role="rowheader"
                      className="sticky left-0 z-10 bg-ivory py-6 pr-4 text-xs font-semibold uppercase tracking-[0.22em] text-forest"
                    >
                      {row.label}
                    </div>
                    {row.cells.map((cell, i) => (
                      <div
                        key={i}
                        role="cell"
                        className={
                          i === 2
                            ? `border-x border-gold/60 bg-champagne px-6 py-6 text-[15px] font-medium text-forest ${r === COMPARE_ROWS.length - 1 ? 'border-b' : ''} ${r === COMPARE_ROWS.length - 1 ? 'pb-9' : ''}`
                            : 'px-6 py-6 text-[15px] text-sage'
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

          <p data-reveal className="mt-8 max-w-3xl text-sm leading-relaxed text-sage">
            {COMPARE_NOTE}
          </p>
        </div>
      </div>
    </section>
  )
}
