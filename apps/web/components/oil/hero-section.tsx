'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { ArrowDown } from 'lucide-react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'
import { BottleIllustration, MaskLines, SeedParticles } from './primitives'

export function HeroSection() {
  const root = useRef<HTMLElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap
        .timeline({ delay: 1.7, defaults: { ease: 'power3.out' } })
        .from('[data-h-eyebrow]', { opacity: 0, y: 16, duration: 0.9 })
        .from(
          '.mask-inner',
          { yPercent: 112, duration: 1.3, stagger: 0.14, ease: 'power4.out' },
          '-=0.5',
        )
        .from('[data-h-copy]', { opacity: 0, y: 24, duration: 1 }, '-=0.8')
        .from('[data-h-cta]', { opacity: 0, y: 24, duration: 0.9, stagger: 0.12 }, '-=0.7')
        .fromTo(
          '[data-h-frame]',
          { clipPath: 'inset(100% 0% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.8, ease: 'power4.inOut' },
          0.1,
        )
        .from('[data-h-img]', { scale: 1.35, duration: 2.4, ease: 'power3.out' }, 0.1)
        .from('[data-h-bottle]', { opacity: 0, y: 90, duration: 1.4 }, 0.9)
        .from('[data-h-meta]', { opacity: 0, duration: 1 }, 1.6)

      const scrollOpts = (scrub: boolean | number = true) => ({
        trigger: root.current,
        start: 'top top',
        end: 'bottom top',
        scrub,
      })
      gsap.to('[data-h-img-wrap]', { yPercent: 10, ease: 'none', scrollTrigger: scrollOpts() })
      gsap.to('[data-h-bottle-wrap]', {
        yPercent: -22,
        ease: 'none',
        scrollTrigger: scrollOpts(0.8),
      })
      gsap.to('[data-h-text]', { yPercent: -6, ease: 'none', scrollTrigger: scrollOpts() })
    }, root)
    return () => ctx.revert()
  }, [])

  return (
    <section
      id="top"
      ref={root}
      className="bg-ivory text-ink relative isolate min-h-[100svh] overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_35%,rgba(195,162,101,0.28),transparent_55%),linear-gradient(180deg,#fcf9f3_0%,#f3ebdb_100%)]"
      />
      <SeedParticles />

      <div className="relative mx-auto grid min-h-[100svh] max-w-[1500px] gap-14 px-5 pt-36 pb-20 md:px-10 lg:grid-cols-12 lg:items-center lg:gap-6 lg:pt-40 lg:pb-24">
        <div data-h-text className="relative z-10 lg:col-span-6">
          <p
            data-h-eyebrow
            className="text-bronze mb-8 flex items-center gap-3 text-xs font-medium tracking-[0.28em] uppercase"
          >
            <span aria-hidden className="bg-gold h-px w-8" />
            Whole seeds. Slow press. Nothing else.
          </p>
          <h1 className="text-ink text-[clamp(2.75rem,9.6vw,8.5rem)] leading-[0.92]">
            <MaskLines
              manual
              lines={[
                'The oil',
                'your kitchen',
                <em key="r" className="text-bronze">
                  remembers.
                </em>,
              ]}
            />
          </h1>
          <p data-h-copy className="text-ink/75 mt-9 max-w-xl text-base leading-relaxed md:text-lg">
            Cold-pressed groundnut, sesame and coconut oil, made in small batches and labelled with
            the pressing date.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <a
              data-h-cta
              href="#shop"
              className="bg-gold text-forest hover:bg-champagne hover:text-ivory inline-flex min-h-12 w-full items-center justify-center px-6 text-xs font-semibold tracking-[0.18em] uppercase transition-colors sm:w-auto sm:px-8 sm:tracking-[0.22em]"
            >
              Shop the oils
            </a>
            <a
              data-h-cta
              href="#process"
              className="border-ink/40 text-ink hover:border-gold hover:text-bronze inline-flex min-h-12 w-full items-center justify-center gap-3 border px-6 text-xs font-semibold tracking-[0.14em] whitespace-nowrap uppercase transition-colors sm:w-auto sm:px-8 sm:tracking-[0.22em]"
            >
              See how we press it
              <ArrowDown className="size-4" aria-hidden />
            </a>
          </div>
        </div>

        <div className="relative lg:col-span-6">
          <div
            data-h-frame
            className="bg-sand relative aspect-[4/5] w-full overflow-hidden rounded-t-[999px] shadow-[0_40px_90px_-30px_rgba(132,101,44,0.45)] lg:aspect-auto lg:h-[74svh] lg:min-h-[520px]"
          >
            <div data-h-img-wrap className="absolute -inset-[6%]">
              <div data-h-img className="absolute inset-0">
                <Image
                  src="/images/hero-light.png"
                  alt="Golden oil pouring from a cream ceramic jug into a glass bowl on a marble counter"
                  fill
                  priority
                  sizes="(min-width: 1024px) 48vw, 100vw"
                  className="object-cover"
                />
              </div>
            </div>
            <div
              aria-hidden
              className="from-ivory/55 absolute inset-0 bg-gradient-to-t via-transparent to-transparent"
            />
            <div
              aria-hidden
              className="border-ivory/70 absolute inset-3 rounded-t-[999px] border"
            />
            <p
              data-h-meta
              className="bg-ivory/85 text-forest absolute right-5 bottom-5 max-w-[55%] px-2.5 py-1.5 text-right text-xs leading-snug font-medium tracking-[0.16em] uppercase backdrop-blur-sm"
            >
              [SLOW-MOTION GOLDEN OIL POUR LOOP]
            </p>
          </div>

          <div
            data-h-bottle-wrap
            className="absolute -bottom-6 left-1 z-10 w-[34%] max-w-[210px] sm:left-6 lg:-bottom-10 lg:-left-16 lg:w-[30%]"
          >
            <div data-h-bottle className="relative">
              <div
                aria-hidden
                className="absolute top-[48%] left-1/2 -z-10 aspect-square w-[190%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.95)_0%,rgba(243,235,219,0.7)_40%,transparent_70%)]"
              />
              <div
                aria-hidden
                className="border-gold/50 absolute top-[48%] left-1/2 -z-10 aspect-square w-[150%] -translate-x-1/2 -translate-y-1/2 rounded-full border"
              />
              <div className="animate-float drop-shadow-[0_28px_28px_rgba(132,101,44,0.35)]">
                <BottleIllustration title="Groundnut" className="h-auto w-full" />
              </div>
            </div>
          </div>
          <p
            data-h-meta
            className="text-ink/55 mt-10 ml-auto max-w-[55%] text-right text-xs tracking-[0.22em] uppercase sm:max-w-none lg:mt-14"
          >
            Bottle illustration / media placeholder
          </p>
        </div>
      </div>
    </section>
  )
}
