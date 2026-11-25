'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { KITCHEN_CARDS, KITCHEN_NOTE } from '@/lib/content'
import { cn } from '@/lib/utils'
import { Eyebrow, MaskLines } from './primitives'

export function KitchenGallery() {
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef({ active: false, startX: 0, startScroll: 0 })
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const el = track.current
    if (!el) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const max = el.scrollWidth - el.clientWidth
        setProgress(max > 0 ? el.scrollLeft / max : 0)
        const mid = el.getBoundingClientRect().left + el.clientWidth / 2
        el.querySelectorAll<HTMLElement>('[data-card]').forEach((card) => {
          const r = card.getBoundingClientRect()
          const offset = (r.left + r.width / 2 - mid) / el.clientWidth
          card.style.setProperty('--shift', `${offset * -36}px`)
        })
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  const scrollByCard = (dir: 1 | -1) => {
    const el = track.current
    const card = el?.querySelector<HTMLElement>('[data-card]')
    if (!el || !card) return
    el.scrollBy({ left: dir * (card.offsetWidth + 20), behavior: 'smooth' })
  }

  return (
    <section className="bg-ivory overflow-hidden py-24 md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <Eyebrow>05 / From the first splutter</Eyebrow>
            <h2 className="text-forest mt-8 text-[clamp(2.75rem,6vw,5.5rem)] leading-[1]">
              <MaskLines lines={['For every', <em key="k">kitchen moment.</em>]} />
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => scrollByCard(-1)}
              aria-label="Previous"
              className="border-forest/30 text-forest hover:bg-forest hover:text-ivory flex size-12 items-center justify-center border transition-colors"
            >
              <ArrowLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => scrollByCard(1)}
              aria-label="Next"
              className="border-forest/30 text-forest hover:bg-forest hover:text-ivory flex size-12 items-center justify-center border transition-colors"
            >
              <ArrowRight className="size-5" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={track}
        data-lenis-prevent-wheel
        role="region"
        aria-label="Kitchen moments"
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') return
          drag.current = {
            active: true,
            startX: e.clientX,
            startScroll: track.current?.scrollLeft ?? 0,
          }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          if (!drag.current.active || !track.current) return
          track.current.scrollLeft = drag.current.startScroll - (e.clientX - drag.current.startX)
        }}
        onPointerUp={() => {
          drag.current.active = false
          setDragging(false)
        }}
        onPointerLeave={() => {
          drag.current.active = false
          setDragging(false)
        }}
        className={cn(
          'no-scrollbar mt-14 flex gap-5 overflow-x-auto px-5 pb-4 md:px-10',
          dragging ? 'cursor-grabbing select-none' : 'cursor-grab snap-x snap-mandatory',
        )}
      >
        {KITCHEN_CARDS.map((card) => (
          <article
            key={card.n}
            data-card
            className="group bg-forest relative aspect-[3/4] w-[82vw] shrink-0 snap-center overflow-hidden sm:w-[52vw] lg:w-[34vw] xl:w-[30vw]"
          >
            <div className="absolute -inset-x-[12%] inset-y-0 translate-x-[var(--shift,0px)] will-change-transform">
              <Image
                src={card.image}
                alt={card.alt}
                fill
                draggable={false}
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105"
              />
            </div>
            <div
              aria-hidden
              className="from-forest/90 via-forest/20 absolute inset-0 bg-gradient-to-t to-transparent"
            />
            <div className="text-ivory absolute inset-x-0 bottom-0 p-6 md:p-8">
              <p className="text-gold font-mono text-xs tracking-widest">{card.n}</p>
              <h3 className="mt-3 font-serif text-4xl italic md:text-5xl">{card.title}</h3>
              <p className="text-ivory/80 mt-3 max-w-xs text-[15px] leading-relaxed">{card.body}</p>
              <p className="text-ivory/70 mt-5 text-xs font-medium tracking-[0.16em] uppercase">
                {card.caption} <span className="text-gold">· MEDIA PLACEHOLDER</span>
              </p>
            </div>
          </article>
        ))}
      </div>

      <div className="mx-auto mt-10 max-w-[1400px] px-5 md:px-10">
        <div className="bg-forest/15 h-px w-full">
          <div
            className="bg-forest h-px origin-left"
            style={{ transform: `scaleX(${0.2 + progress * 0.8})` }}
          />
        </div>
        <p data-reveal className="text-sage mt-10 max-w-2xl text-sm leading-relaxed">
          {KITCHEN_NOTE}
        </p>
      </div>
    </section>
  )
}
