'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { gsap, ScrollTrigger, prefersReducedMotion } from '@/lib/gsap'
import { setLenis } from '@/lib/lenis'

function Curtain() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    if (prefersReducedMotion()) {
      el.style.display = 'none'
      return
    }
    const ctx = gsap.context(() => {
      gsap
        .timeline({
          defaults: { ease: 'power3.out' },
          onComplete: () => {
            el.style.display = 'none'
          },
        })
        .from('[data-curtain-char]', { yPercent: 110, opacity: 0, duration: 1, stagger: 0.04 })
        .from('[data-curtain-line]', { scaleX: 0, duration: 1, ease: 'power3.inOut' }, 0.3)
        .to('[data-curtain-brand]', { opacity: 0, y: -20, duration: 0.5, ease: 'power2.in' }, '+=0.35')
        .to(el, { yPercent: -100, duration: 1.1, ease: 'power4.inOut' }, '-=0.2')
    }, el)
    return () => ctx.revert()
  }, [])

  const brand = '[YOUR BRAND]'
  return (
    <div
      ref={root}
      aria-hidden
      className="curtain fixed inset-0 z-[100] flex items-center justify-center bg-champagne"
    >
      <div data-curtain-brand className="flex flex-col items-center gap-5 px-6 text-center">
        <span className="flex overflow-hidden pb-2 font-serif text-4xl italic text-ink md:text-6xl">
          {brand.split('').map((ch, i) => (
            <span key={i} data-curtain-char className="inline-block whitespace-pre">
              {ch}
            </span>
          ))}
        </span>
        <span
          data-curtain-line
          className="block h-px w-40 origin-left bg-gold"
        />
      </div>
    </div>
  )
}

export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const reduce = prefersReducedMotion()
    let lenis: Lenis | null = null
    let tick: ((time: number) => void) | null = null

    if (!reduce) {
      lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
      setLenis(lenis)
      lenis.on('scroll', ScrollTrigger.update)
      tick = (time: number) => lenis?.raf(time * 1000)
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
    }

    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
      if (!anchor) return
      const hash = anchor.getAttribute('href') ?? ''
      if (hash.length < 2) return
      const target = document.querySelector<HTMLElement>(hash)
      if (!target) return
      event.preventDefault()
      if (lenis) lenis.scrollTo(target, { offset: -64, duration: 1.8 })
      else target.scrollIntoView({ behavior: 'auto' })
      history.replaceState(null, '', hash)
    }
    document.addEventListener('click', onClick)

    let ctx: gsap.Context | undefined
    if (!reduce) {
      const isMobile = window.innerWidth < 768
      ctx = gsap.context(() => {
        const trigger = (el: Element, start = 'top 88%') => ({ trigger: el, start, once: true })

        gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
          gsap.from(el, {
            y: 36,
            opacity: 0,
            duration: 0.9,
            ease: 'power3.out',
            delay: Number(el.dataset.delay ?? 0),
            scrollTrigger: trigger(el),
          })
        })

        gsap.utils.toArray<HTMLElement>('[data-stagger]').forEach((el) => {
          gsap.from(el.children, {
            y: 34,
            opacity: 0,
            duration: 0.9,
            stagger: Number(el.dataset.stagger || 0.1),
            ease: 'power3.out',
            scrollTrigger: trigger(el, 'top 85%'),
          })
        })

        gsap.utils.toArray<HTMLElement>('[data-mask]').forEach((el) => {
          gsap.from(el.querySelectorAll('.mask-inner'), {
            yPercent: 112,
            duration: 1.15,
            stagger: 0.12,
            ease: 'power4.out',
            scrollTrigger: trigger(el, 'top 90%'),
          })
        })

        gsap.utils.toArray<HTMLElement>('[data-clip]').forEach((el) => {
          const inner = el.querySelector('[data-clip-inner]')
          gsap.fromTo(
            el,
            { clipPath: 'inset(100% 0% 0% 0%)' },
            {
              clipPath: 'inset(0% 0% 0% 0%)',
              duration: 1.5,
              ease: 'power4.inOut',
              scrollTrigger: trigger(el, 'top 85%'),
            },
          )
          if (inner) {
            gsap.from(inner, {
              scale: 1.3,
              duration: 2,
              ease: 'power3.out',
              scrollTrigger: trigger(el, 'top 85%'),
            })
          }
        })

        gsap.utils.toArray<HTMLElement>('[data-line]').forEach((el) => {
          gsap.from(el, {
            scaleX: 0,
            transformOrigin: 'left center',
            duration: 1.3,
            ease: 'power3.inOut',
            scrollTrigger: trigger(el, 'top 92%'),
          })
        })

        if (!isMobile) {
          gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
            const amount = Number(el.dataset.parallax)
            gsap.fromTo(
              el,
              { yPercent: -amount },
              {
                yPercent: amount,
                ease: 'none',
                scrollTrigger: {
                  trigger: el.parentElement,
                  start: 'top bottom',
                  end: 'bottom top',
                  scrub: true,
                },
              },
            )
          })
        }
      })
    }

    const refresh = () => ScrollTrigger.refresh()
    window.addEventListener('load', refresh)
    const timer = window.setTimeout(refresh, 1200)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('load', refresh)
      document.removeEventListener('click', onClick)
      ctx?.revert()
      if (tick) gsap.ticker.remove(tick)
      lenis?.destroy()
      setLenis(null)
    }
  }, [])

  return (
    <>
      <Curtain />
      {children}
    </>
  )
}
