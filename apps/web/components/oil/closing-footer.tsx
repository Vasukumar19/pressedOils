import Image from 'next/image'
import { CONTACT, isReal } from '@/lib/content'
import { MaskLines, Ph } from './primitives'

export function ClosingCta() {
  return (
    <section className="bg-champagne text-ink relative isolate overflow-hidden py-36 md:py-56">
      <Image
        src="/images/closing-light.png"
        alt=""
        fill
        sizes="100vw"
        className="-z-10 object-cover object-right"
      />
      <div
        aria-hidden
        className="from-ivory via-ivory/80 to-ivory/10 md:via-ivory/55 absolute inset-0 -z-10 bg-gradient-to-r"
      />
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <p
          data-reveal
          className="text-bronze flex items-center gap-3 text-xs font-medium tracking-[0.28em] uppercase"
        >
          <span aria-hidden className="bg-gold h-px w-8" />
          Back to what matters
        </p>
        <h2 className="mt-8 max-w-4xl text-[clamp(3rem,8vw,7.5rem)] leading-[0.95]">
          <MaskLines
            lines={[
              'Taste the',
              'difference in',
              <em key="m" className="text-bronze">
                your next meal.
              </em>,
            ]}
          />
        </h2>
        <a
          data-reveal
          href="#shop"
          className="bg-gold text-forest hover:bg-champagne hover:text-ivory mt-12 inline-flex min-h-12 items-center px-9 text-[12px] font-semibold tracking-[0.22em] uppercase transition-colors"
        >
          Explore the oils
        </a>
      </div>
    </section>
  )
}

function ContactLink({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <p>
      <span className="text-ink/55">{label} </span>
      {isReal(value) ? (
        <a href={href} className="link-underline text-ink pb-0.5">
          {value}
        </a>
      ) : (
        <span className="ph text-ink">{value}</span>
      )}
    </p>
  )
}

export function Footer() {
  return (
    <footer className="border-gold/40 bg-sand text-ink border-t px-5 pt-20 pb-10 md:px-10">
      <div className="mx-auto grid max-w-[1400px] gap-14 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <p className="font-serif text-5xl italic md:text-7xl">[YOUR BRAND]</p>
          <p className="text-bronze mt-4 font-serif text-2xl font-medium md:text-3xl">
            Good oil. An open kitchen.
          </p>
        </div>
        <div className="grid gap-10 text-sm leading-relaxed sm:grid-cols-2 lg:col-span-6">
          <div className="space-y-3">
            <p className="text-bronze text-xs font-semibold tracking-[0.28em] uppercase">Licence</p>
            <p>
              <Ph>FSSAI [NO.]</Ph>
            </p>
            <p className="text-ink/75">
              <Ph>[REGISTERED ADDRESS]</Ph>
            </p>
          </div>
          <div className="space-y-3">
            <p className="text-bronze text-xs font-semibold tracking-[0.28em] uppercase">Contact</p>
            <ContactLink
              label="WhatsApp"
              value={CONTACT.whatsapp}
              href={`https://wa.me/${CONTACT.whatsapp.replace(/\D/g, '')}`}
            />
            <ContactLink label="Email" value={CONTACT.email} href={`mailto:${CONTACT.email}`} />
          </div>
          <div className="space-y-3 sm:col-span-2">
            <p className="text-bronze text-xs font-semibold tracking-[0.28em] uppercase">
              Policies
            </p>
            <p className="text-ink/80 flex flex-wrap gap-x-6 gap-y-2">
              <span className="ph">[SHIPPING POLICY]</span>
              <span className="ph">[PRIVACY POLICY]</span>
              <span className="ph">[RETURNS &amp; REPLACEMENT TERMS]</span>
            </p>
          </div>
        </div>
      </div>
      <div className="border-gold/25 text-ink/55 mx-auto mt-16 max-w-[1400px] border-t pt-6 text-xs">
        <Ph>© [YEAR] [YOUR BRAND]. Brand, licence and verification details pending.</Ph>
      </div>
    </footer>
  )
}
