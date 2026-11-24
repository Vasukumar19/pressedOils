'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { FAQ_ITEMS } from '@/lib/content'
import { cn } from '@/lib/utils'
import { Eyebrow, MaskLines, MediaFrame, Ph } from './primitives'

export function GiftSection() {
  return (
    <section className="bg-champagne py-24 text-ink md:py-36">
      <div className="mx-auto grid max-w-[1400px] items-center gap-14 px-5 md:px-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-6 lg:order-2">
          <MediaFrame
            src="/images/gift-set.png"
            alt="A green gift box holding three small glass oil bottles"
            caption="[PHOTO / ELEGANT BOXED OIL SET]"
            clip
            parallax={6}
            className="aspect-[4/3] w-full"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>
        <div className="lg:col-span-6 lg:order-1">
          <Eyebrow tone="dark">08 / Something worth sharing</Eyebrow>
          <h2 className="mt-8 text-[clamp(2.75rem,6vw,5.5rem)] leading-[1]">
            <MaskLines lines={['Good things,', <em key="g" className="text-bronze">beautifully given.</em>]} />
          </h2>
          <div data-stagger="0.12" className="mt-10 max-w-md">
            <h3 className="font-serif font-medium text-3xl italic">A place at every celebration.</h3>
            <p className="mt-6 text-[15px] leading-relaxed text-ink/80">
              <Ph>[FESTIVAL GIFT SET NAME] · [CONTENTS] · [SIZES]</Ph>
            </p>
            <p className="mt-4 font-serif font-medium text-3xl">
              From <span className="ph">[PRICE]</span>
            </p>
            <p className="mt-4 text-sm text-ink/60">
              Gift collection preview. Packaging, prices and availability to be confirmed.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="faq" className="bg-ivory py-24 md:py-36">
      <div className="mx-auto grid max-w-[1400px] gap-14 px-5 md:px-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <Eyebrow>09 / A few honest answers</Eyebrow>
          <h2 className="mt-8 text-[clamp(2.75rem,5.4vw,5rem)] leading-[1] text-forest">
            <MaskLines lines={['Before it reaches', <em key="k">your kitchen.</em>]} />
          </h2>
          <div data-reveal className="mt-12 border border-forest/25 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-forest">Our promise</p>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/85">
              Easy return or replacement if the oil is not as described.{' '}
              <span className="ph">[CONFIRM TERMS BEFORE LAUNCH]</span>
            </p>
          </div>
        </div>

        <div data-stagger="0.08" className="lg:col-span-7">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i
            return (
              <div key={item.q} className="border-t border-forest/20 last:border-b">
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${i}`}
                    id={`faq-trigger-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex min-h-16 w-full items-center justify-between gap-6 py-6 text-left"
                  >
                    <span className="font-serif font-medium text-2xl text-forest md:text-3xl">
                      <Ph>{item.q}</Ph>
                    </span>
                    <Plus
                      aria-hidden
                      className={cn(
                        'size-6 shrink-0 text-forest transition-transform duration-500',
                        isOpen && 'rotate-45',
                      )}
                    />
                  </button>
                </h3>
                <div
                  id={`faq-panel-${i}`}
                  role="region"
                  aria-labelledby={`faq-trigger-${i}`}
                  className={cn(
                    'grid transition-[grid-template-rows] duration-500 ease-out',
                    isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="max-w-xl pb-7 text-[15px] leading-relaxed text-sage">
                      <Ph>{item.a}</Ph>
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
