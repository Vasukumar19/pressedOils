import Image from 'next/image'
import type { PublicSettingsResponseDto } from '@pressedoils/shared'
import { FileText, MapPin, MessageSquareQuote, ShieldCheck } from 'lucide-react'
import { TRUST_CARDS } from '@/lib/content'
import { Eyebrow, MaskLines, MediaFrame, Ph } from './primitives'

interface FounderStoryProps {
  brandName?: string
}

export function FounderStory({ brandName = '[BRAND]' }: FounderStoryProps) {
  return (
    <section id="story" className="bg-ivory overflow-hidden py-24 md:py-36">
      <div className="mx-auto grid max-w-[1400px] items-center gap-14 px-5 md:px-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-6">
          <MediaFrame
            src="/images/tempering.png"
            alt="Hands holding a tempering pan with spices and curry leaves"
            caption="[PHOTO / HANDS, TEMPERING PAN & CURRY LEAVES]"
            clip
            parallax={7}
            className="aspect-[4/5] w-full lg:aspect-[5/6]"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>
        <div className="lg:col-span-6 lg:pl-6">
          <Eyebrow>03 / A memory, made again</Eyebrow>
          <h2 className="text-forest mt-8 text-[clamp(2.5rem,5.4vw,5rem)] leading-[1]">
            <MaskLines lines={['It started with', 'the smell of', <em key="k">a kitchen.</em>]} />
          </h2>
          <div
            data-stagger="0.15"
            className="text-ink/85 mt-10 max-w-lg space-y-6 text-lg leading-relaxed"
          >
            <p>
              <Ph>
                [FOUNDER NAME] remembers [A SPECIFIC KITCHEN MOMENT: the sound of tempering, the
                smell of warm sesame oil].
              </Ph>
            </p>
            <p>The oil from the shop never smelled like that, and the label never said why.</p>
            <p>
              <Ph>
                {`${brandName} began with a simple question: what if oil could be made slowly, openly and in a way you could trace?`}
              </Ph>
            </p>
            <figure className="border-gold border-l-2 pt-2 pl-6">
              <blockquote className="text-forest font-serif text-2xl leading-snug font-medium italic md:text-3xl">
                <Ph>[SHORT FOUNDER QUOTE]</Ph>
              </blockquote>
              <figcaption className="text-sage mt-4 text-xs font-semibold tracking-[0.24em] uppercase">
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

interface TrustSectionProps {
  settings?: PublicSettingsResponseDto
  hasVerifiedLabReports?: boolean
  isProduction?: boolean
}

export function TrustSection({
  settings,
  hasVerifiedLabReports = false,
  isProduction = false,
}: TrustSectionProps) {
  const fssaiText = settings?.fssaiNumber ? `FSSAI ${settings.fssaiNumber}` : 'FSSAI [NO.]'
  const addressText = settings?.registeredAddress || '[REGISTERED ADDRESS]'

  const resolvedCards = TRUST_CARDS.map((card, index) => {
    if (index === 0) {
      if (hasVerifiedLabReports) {
        return {
          ...card,
          body: 'Third-party batch test date, batch number and PDF report linked on every oil page.',
        }
      }
      if (isProduction) {
        return {
          n: card.n,
          title: 'Batch numbers and pressing dates',
          body: 'Every bottle carries its batch number, pressing date and seed origin on the label.',
        }
      }
      return {
        ...card,
        body: 'Lab report pending upload in preview mode. Batch numbers and pressing dates are active.',
      }
    }
    if (index === 1) {
      return {
        ...card,
        body: `${fssaiText} · ${addressText}`,
      }
    }
    return card
  })

  return (
    <section className="bg-champagne text-ink py-24 md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <Eyebrow tone="dark">04 / Trust is in the details</Eyebrow>
        <h2 className="mt-8 max-w-3xl text-[clamp(2.75rem,6vw,5.5rem)] leading-[1]">
          <MaskLines
            lines={[
              'Don’t take',
              <em key="w" className="text-bronze">
                our word for it.
              </em>,
            ]}
          />
        </h2>

        <div data-stagger="0.12" className="mt-16 grid gap-4 md:mt-24 md:grid-cols-12">
          {resolvedCards.map((card, i) => {
            const Icon = ICONS[i]
            const backdrop = BACKDROPS[i]
            const span =
              i === 0
                ? 'md:col-span-7'
                : i === 1
                  ? 'md:col-span-5'
                  : i === 2
                    ? 'md:col-span-5'
                    : 'md:col-span-7'
            return (
              <article
                key={card.n}
                className={`group border-gold/30 bg-ivory relative isolate flex min-h-[300px] flex-col justify-between overflow-hidden border p-7 md:min-h-[340px] md:p-10 ${span}`}
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
                  <Icon className="text-bronze size-7" strokeWidth={1.25} aria-hidden />
                  <span className="text-bronze font-mono text-xs tracking-widest">{card.n}</span>
                </div>
                <div>
                  <h3 className="font-serif text-3xl leading-tight font-medium md:text-4xl">
                    {card.title}
                  </h3>
                  <p className="text-ink/75 mt-4 max-w-md text-[15px] leading-relaxed">
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
