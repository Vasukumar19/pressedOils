'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PublicProductDto, PublicSettingsResponseDto } from '@pressedoils/shared'
import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, Search } from 'lucide-react'
import { resolveLabReportPresentation } from '@/lib/lab-report'
import { Eyebrow, MaskLines, Ph } from './primitives'

interface BatchLookupProps {
  products?: PublicProductDto[]
  settings?: PublicSettingsResponseDto
  isProduction?: boolean
  allowedReportDomains?: readonly string[]
}

export function BatchLookup({
  products = [],
  settings,
  isProduction = false,
  allowedReportDomains = [],
}: BatchLookupProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const batch = value.trim()
    if (!batch) {
      setError('Enter a batch number to look up pressing details.')
      setSubmitted(null)
      return
    }
    setError('')
    setSubmitted(batch)
  }

  const matchedProduct = submitted
    ? (products.find((p) => p.currentBatch?.batchNo.toUpperCase() === submitted.toUpperCase()) ??
      null)
    : null

  const matchedBatch = matchedProduct?.currentBatch ?? null
  const labPresentation = resolveLabReportPresentation(matchedBatch, {
    isProduction,
    allowedReportDomains,
  })

  const fssaiLabel = settings?.fssaiNumber ? `FSSAI ${settings.fssaiNumber}` : 'FSSAI [NO.]'

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
                placeholder={
                  products[0]?.currentBatch?.batchNo
                    ? `e.g. ${products[0].currentBatch.batchNo}`
                    : 'Enter batch number'
                }
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
                View batch
              </button>
            </div>
            {error && (
              <p id="batch-error" role="alert" className="text-error mt-3 text-sm">
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
                    {matchedProduct && matchedBatch ? (
                      <>
                        <p className="bg-gold text-forest mb-5 inline-block px-2.5 py-1 font-mono text-xs font-semibold tracking-[0.2em] uppercase">
                          Active Batch Record
                        </p>
                        <dl className="divide-forest/15 divide-y font-mono text-[13px]">
                          <div className="flex justify-between gap-6 py-3">
                            <dt className="text-sage">Batch number</dt>
                            <dd className="text-forest text-right break-all">
                              {matchedBatch.batchNo}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-6 py-3">
                            <dt className="text-sage">Oil</dt>
                            <dd className="text-forest text-right">
                              <Link
                                href={`/products/${matchedProduct.slug}`}
                                className="link-underline pb-0.5"
                              >
                                {matchedProduct.name}
                              </Link>
                            </dd>
                          </div>
                          <div className="flex justify-between gap-6 py-3">
                            <dt className="text-sage">Pressed on</dt>
                            <dd className="text-forest text-right">
                              {matchedBatch.pressedOnDisplay}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-6 py-3">
                            <dt className="text-sage">Best before</dt>
                            <dd className="text-forest text-right">
                              {matchedBatch.bestBeforeDisplay}
                            </dd>
                          </div>
                          {labPresentation.status === 'verified' && labPresentation.reportUrl ? (
                            <div className="flex justify-between gap-6 py-3">
                              <dt className="text-sage">Lab report</dt>
                              <dd className="text-right">
                                <a
                                  href={labPresentation.reportUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-forest hover:text-bronze inline-flex items-center gap-1.5 underline underline-offset-4"
                                >
                                  View PDF
                                  <ExternalLink className="size-3.5" aria-hidden />
                                </a>
                              </dd>
                            </div>
                          ) : labPresentation.status === 'pending' ? (
                            <div className="flex justify-between gap-6 py-3">
                              <dt className="text-sage">Lab report</dt>
                              <dd className="text-sage text-right">Lab report pending upload</dd>
                            </div>
                          ) : null}
                        </dl>
                      </>
                    ) : (
                      <p className="text-sage text-sm">
                        No active batch matched &ldquo;{submitted}&rdquo;. Check the code printed on
                        your bottle label or view batches on each product page.
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="border-forest/15 text-sage mt-6 border-t pt-4 font-mono text-xs tracking-[0.12em] uppercase">
              <Ph>{`${fssaiLabel} · Batch traceability on every bottle`}</Ph>
            </p>
          </form>
        </div>
      </div>
    </section>
  )
}
