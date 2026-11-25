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
          <h2 className="text-forest mt-8 text-[clamp(2.75rem,6.5vw,5.75rem)] leading-[0.98]">
            <MaskLines lines={['Look up', <em key="b">your batch</em>]} />
          </h2>
          <p data-reveal className="text-sage mt-8 max-w-md text-lg leading-relaxed">
            From the seed to the report. Nothing behind a label.
          </p>
        </div>

        <div data-reveal className="lg:col-span-6 lg:pl-10">
          <form
            onSubmit={onSubmit}
            noValidate
            className="border-forest/25 relative border bg-[#fbf8ef] p-6 md:p-9"
          >
            <span
              aria-hidden
              className="border-gold absolute -top-px -left-px size-4 border-t-2 border-l-2"
            />
            <span
              aria-hidden
              className="border-gold absolute -top-px -right-px size-4 border-t-2 border-r-2"
            />
            <span
              aria-hidden
              className="border-gold absolute -bottom-px -left-px size-4 border-b-2 border-l-2"
            />
            <span
              aria-hidden
              className="border-gold absolute -right-px -bottom-px size-4 border-r-2 border-b-2"
            />

            <label
              htmlFor="batch-number"
              className="text-sage font-mono text-xs tracking-[0.24em] uppercase"
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
                className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-12 flex-1 border px-4 font-mono text-sm"
              />
              <button
                type="submit"
                className="bg-forest text-ivory hover:bg-ink inline-flex min-h-12 items-center justify-center gap-2 px-7 text-[12px] font-semibold tracking-[0.2em] uppercase transition-colors"
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
                  <div className="border-forest/20 mt-7 border-t pt-6">
                    <p className="bg-gold text-forest mb-5 inline-block px-2.5 py-1 font-mono text-xs font-semibold tracking-[0.2em] uppercase">
                      Demo response · illustrative sample
                    </p>
                    <dl className="divide-forest/15 divide-y font-mono text-[13px]">
                      <div className="flex justify-between gap-6 py-3">
                        <dt className="text-sage">Batch number</dt>
                        <dd className="text-forest text-right break-all">{submitted}</dd>
                      </div>
                      {rows.map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-6 py-3">
                          <dt className="text-sage">{k}</dt>
                          <dd className="text-forest text-right">
                            <Ph>{v}</Ph>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-sage mt-4 text-sm">
                      Preview only. No batch has been verified and no real report is attached.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="border-forest/15 text-sage mt-6 border-t pt-4 font-mono text-xs tracking-[0.12em] uppercase">
              <Ph>FSSAI [NO.] · Reports pending upload.</Ph>
            </p>
          </form>
        </div>
      </div>
    </section>
  )
}
