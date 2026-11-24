import Image from 'next/image'
import { FileText, MapPin, MessageSquareQuote, ShieldCheck } from 'lucide-react'
import { TRUST_CARDS } from '@/lib/content'
import { Eyebrow, MaskLines, MediaFrame, Ph } from './primitives'

export function FounderStory() {
  return (
    <section id="story" className="overflow-hidden bg-ivory py-24 md:py-36">
      <div className="mx-auto grid max-w-[1400px] items-center gap-14 px-5 md:px-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-6">
          <MediaFrame
            src="/images/tempering.png"
            alt="Hands holding a tempering pan with mustard seeds and curry leaves"
            caption="[PHOTO / HANDS, TEMPERING PAN & CURRY LEAVES]"
            clip
            parallax={7}
            className="aspect-[4/5] w-full lg:aspect-[5/6]"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>
        <div className="lg:col-span-6 lg:pl-6">
          <Eyebrow>03 / A memory, made again</Eyebrow>
          <h2 className="mt-8 text-[clamp(2.5rem,5.4vw,5rem)] leading-[1] text-forest">
            <MaskLines
              lines={['It started with', 'the smell of', <em key="k">a kitchen.</em>]}
            />
          </h2>
          <div data-stagger="0.15" className="mt-10 max-w-lg space-y-6 text-lg leading-relaxed text-ink/85">
            <p>
              <Ph>
                [FOUNDER NAME] remembers [A SPECIFIC KITCHEN MOMENT: the sound of tempering, the smell of warm sesame oil].
              </Ph>
            </p>
            <p>The oil from the shop never smelled like that, and the label never said why.</p>
            <p>
              <Ph>[BRAND] began with a simple question: what if oil could be made slowly, openly and in a way you could trace?</Ph>
            </p>
            <figure className="border-l-2 border-gold pl-6 pt-2">
              <blockquote className="font-serif font-medium text-2xl italic leading-snug text-forest md:text-3xl">
                <Ph>[SHORT FOUNDER QUOTE]</Ph>
              </blockquote>
              <figcaption className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-sage">
                <Ph>[FOUNDER NAME] / FOUNDER</Ph>
              </figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  )
}

const ICONS = [FileText, ShieldCheck, MapPin, MessageSquareQuote]
const BACKDROPS: Record<number, string> = {
  0: '/images/filtering.png',
  3: '/images/tempering.png',
}

export function TrustSection() {
  return (
    <section className="bg-champagne py-24 text-ink md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <Eyebrow tone="dark">04 / Trust is in the details</Eyebrow>
        <h2 className="mt-8 max-w-3xl text-[clamp(2.75rem,6vw,5.5rem)] leading-[1]">
          <MaskLines lines={['Don’t take', <em key="w" className="text-bronze">our word for it.</em>]} />
        </h2>

        <div data-stagger="0.12" className="mt-16 grid gap-4 md:mt-24 md:grid-cols-12">
          {TRUST_CARDS.map((card, i) => {
            const Icon = ICONS[i]
            const backdrop = BACKDROPS[i]
            const span = i === 0 ? 'md:col-span-7' : i === 1 ? 'md:col-span-5' : i === 2 ? 'md:col-span-5' : 'md:col-span-7'
            return (
              <article
                key={card.n}
                className={`group relative isolate flex min-h-[300px] flex-col justify-between overflow-hidden border border-gold/30 bg-ivory p-7 md:min-h-[340px] md:p-10 ${span}`}
              >
                {backdrop && (
                  <Image
                    src={backdrop}
                    alt=""
                    fill
                    sizes="(min-width: 768px) 58vw, 100vw"
                    className="-z-10 object-cover opacity-[0.16] transition-all duration-[1200ms] ease-out group-hover:scale-105 group-hover:opacity-[0.26]"
                  />
                )}
                <div className="flex items-start justify-between">
                  <Icon className="size-7 text-bronze" strokeWidth={1.25} aria-hidden />
                  <span className="font-mono text-xs tracking-widest text-bronze">{card.n}</span>
                </div>
                <div>
                  <h3 className="font-serif font-medium text-3xl leading-tight md:text-4xl">{card.title}</h3>
                  <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink/75">
                    <Ph>{card.body}</Ph>
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
