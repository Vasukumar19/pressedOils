'use client'

import { useEffect, useRef, useState } from 'react'
import { gsap } from '@/lib/gsap'
import { PROCESS_STEPS } from '@/lib/content'
import { Eyebrow, MaskLines, MediaFrame } from './primitives'

const N = PROCESS_STEPS.length
const pad = (n: number) => String(n).padStart(2, '0')

function StepText({ step }: { step: (typeof PROCESS_STEPS)[number] }) {
  return (
    <>
      <h3 className="text-ink font-serif text-4xl leading-[1.05] md:text-5xl xl:text-6xl">
        <span className="text-bronze">{step.n}</span> — {step.title}
      </h3>
      <p className="text-ink/75 mt-6 max-w-md text-base leading-relaxed md:text-lg">{step.body}</p>
      <div className="border-gold/40 mt-8 max-w-md border-t pt-4">
        <p className="text-bronze text-xs font-semibold tracking-[0.28em] uppercase">
          What we leave out
        </p>
        <p className="text-ink mt-2 font-serif text-2xl font-medium italic">{step.leaveOut}</p>
      </div>
    </>
  )
}

export function ProcessSection() {
  const root = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const mm = gsap.matchMedia()
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const imgs = gsap.utils.toArray<HTMLElement>('[data-step-img]')
      const inners = gsap.utils.toArray<HTMLElement>('[data-step-inner]')
      const texts = gsap.utils.toArray<HTMLElement>('[data-step-text]')

      gsap.set(imgs.slice(1), { clipPath: 'inset(100% 0% 0% 0%)' })
      gsap.set(texts.slice(1), { autoAlpha: 0, y: 48 })

      const total = N - 1 + 0.6
      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: '[data-pin]',
          start: 'top top',
          end: '+=480%',
          pin: true,
          scrub: 0.7,
          anticipatePin: 1,
        },
        onUpdate: () => setActive(Math.min(N - 1, Math.floor(tl.time() + 0.2))),
      })

      tl.fromTo(inners[0], { scale: 1.15 }, { scale: 1, duration: 0.6, ease: 'none' }, 0)
      for (let i = 1; i < N; i++) {
        const t = i - 0.4
        tl.to(texts[i - 1], { autoAlpha: 0, y: -48, duration: 0.3 }, t)
          .to(imgs[i], { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.5 }, t)
          .fromTo(inners[i], { scale: 1.3 }, { scale: 1, duration: 1, ease: 'none' }, t)
          .to(texts[i], { autoAlpha: 1, y: 0, duration: 0.4 }, t + 0.25)
      }
      tl.to('[data-progress]', { scaleX: 1, duration: total, ease: 'none' }, 0)
      tl.to({}, { duration: 0.01 }, total)
      return () => setActive(0)
    })
    return () => mm.revert()
  }, [])

  return (
    <section id="process" ref={root} className="bg-champagne text-ink">
      {/* Desktop: pinned scroll story */}
      <div data-pin className="relative hidden h-[100svh] overflow-hidden lg:block">
        <div className="mx-auto grid h-full max-w-[1500px] grid-cols-12 gap-10 px-10 pt-28 pb-12">
          <div className="col-span-5 flex flex-col">
            <Eyebrow tone="dark">02 / The slow way</Eyebrow>
            <h2 className="mt-5 text-5xl leading-[1] xl:text-6xl">
              Six steps. <em className="text-bronze">Nothing to hurry.</em>
            </h2>

            <div className="relative mt-10 flex-1">
              {PROCESS_STEPS.map((step) => (
                <div key={step.n} data-step-text className="absolute inset-x-0 top-0">
                  <StepText step={step} />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-5">
              <span
                key={active}
                className="animate-in fade-in slide-in-from-bottom-2 text-bronze font-mono text-sm tracking-widest tabular-nums duration-500"
              >
                {pad(active + 1)} / {pad(N)}
              </span>
              <div className="bg-ink/15 h-px flex-1">
                <div data-progress className="bg-gold h-px origin-left scale-x-0" />
              </div>
            </div>
          </div>

          <div className="relative col-span-7">
            {PROCESS_STEPS.map((step) => (
              <div key={step.n} data-step-img className="absolute inset-0">
                <div data-step-inner className="absolute inset-0">
                  <MediaFrame
                    src={step.image}
                    alt={step.alt}
                    caption={step.caption}
                    sizes="58vw"
                    className="h-full w-full"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile and tablet: stacked cards */}
      <div className="px-5 py-24 md:px-10 lg:hidden">
        <Eyebrow tone="dark">02 / The slow way</Eyebrow>
        <h2 className="mt-6 text-5xl leading-[1] md:text-6xl">
          <MaskLines
            lines={[
              'Six steps.',
              <em key="n" className="text-bronze">
                Nothing to hurry.
              </em>,
            ]}
          />
        </h2>
        <ol className="mt-14 grid gap-16 md:grid-cols-2">
          {PROCESS_STEPS.map((step) => (
            <li key={step.n} data-reveal>
              <MediaFrame
                src={step.image}
                alt={step.alt}
                caption={step.caption}
                sizes="(min-width: 768px) 45vw, 100vw"
                className="aspect-[4/3] w-full"
              />
              <p className="text-bronze mt-5 font-mono text-xs tracking-widest">
                {step.n} / {pad(N)}
              </p>
              <div className="mt-3">
                <StepText step={step} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
