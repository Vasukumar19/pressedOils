'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Search } from 'lucide-react'
import { Eyebrow, MaskLines, Ph } from './primitives'

export function BatchLookup() {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const batch = value.trim()
    if (!batch) {
      setError('Enter a batch number to preview the lookup.')
      setSubmitted(null)
      return
    }
    setError('')
    setSubmitted(batch)
  }

  const rows: [string, string][] = [
    ['Pressing date', '[DATE]'],
    ['Seed', '[SEED]'],
    ['Lab report', '[LAB REPORT PDF] · Pending upload'],
  ]

  return (
    <section id="batch" className="bg-ivory py-24 md:py-36">
      <div className="mx-auto grid max-w-[1400px] gap-14 px-5 md:px-10 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-6">
          <Eyebrow>A familiar aroma. An open book.</Eyebrow>
          <h2 className="mt-8 text-[clamp(2.75rem,6.5vw,5.75rem)] leading-[0.98] text-forest">
            <MaskLines lines={['Look up', <em key="b">your batch</em>]} />
          </h2>
          <p data-reveal className="mt-8 max-w-md text-lg leading-relaxed text-sage">
            From the seed to the report. Nothing behind a label.
          </p>
        </div>

        <div data-reveal className="lg:col-span-6 lg:pl-10">
          <form
            onSubmit={onSubmit}
            noValidate
            className="relative border border-forest/25 bg-[#fbf8ef] p-6 md:p-9"
          >
            <span aria-hidden className="absolute -left-px -top-px size-4 border-l-2 border-t-2 border-gold" />
            <span aria-hidden className="absolute -right-px -top-px size-4 border-r-2 border-t-2 border-gold" />
            <span aria-hidden className="absolute -bottom-px -left-px size-4 border-b-2 border-l-2 border-gold" />
            <span aria-hidden className="absolute -bottom-px -right-px size-4 border-b-2 border-r-2 border-gold" />

            <label
              htmlFor="batch-number"
              className="font-mono text-xs uppercase tracking-[0.24em] text-sage"
            >
              Batch number
            </label>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                id="batch-number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Enter batch number"
                autoComplete="off"
                aria-invalid={!!error}
                aria-describedby={error ? 'batch-error' : undefined}
                className="min-h-12 flex-1 border border-forest/30 bg-ivory px-4 font-mono text-sm text-forest placeholder:text-sage/70 focus-visible:border-forest"
              />
              <button
                type="submit"
                className="inline-flex min-h-12 items-center justify-center gap-2 bg-forest px-7 text-[12px] font-semibold uppercase tracking-[0.2em] text-ivory transition-colors hover:bg-ink"
              >
                <Search className="size-4" aria-hidden />
                View report
              </button>
            </div>
            {error && (
              <p id="batch-error" role="alert" className="mt-3 text-sm text-[#8a2c1b]">
                {error}
              </p>
            )}

            <AnimatePresence initial={false}>
              {submitted && (
                <motion.div
                  key={submitted}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                  aria-live="polite"
                >
                  <div className="mt-7 border-t border-forest/20 pt-6">
                    <p className="mb-5 inline-block bg-gold px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-forest">
                      Demo response · illustrative sample
                    </p>
                    <dl className="divide-y divide-forest/15 font-mono text-[13px]">
                      <div className="flex justify-between gap-6 py-3">
                        <dt className="text-sage">Batch number</dt>
                        <dd className="break-all text-right text-forest">{submitted}</dd>
                      </div>
                      {rows.map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-6 py-3">
                          <dt className="text-sage">{k}</dt>
                          <dd className="text-right text-forest">
                            <Ph>{v}</Ph>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-4 text-sm text-sage">
                      Preview only. No batch has been verified and no real report is attached.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="mt-6 border-t border-forest/15 pt-4 font-mono text-xs uppercase tracking-[0.12em] text-sage">
              <Ph>FSSAI [NO.] · Reports pending upload.</Ph>
            </p>
          </form>
        </div>
      </div>
    </section>
  )
}
