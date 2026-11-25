import { colors, fonts, motion } from '@/lib/tokens'

export const metadata = {
  title: 'Design Tokens & Style Guide',
  robots: 'noindex, nofollow',
}

function Swatch({
  name,
  hex,
  textClass = 'text-ink',
}: {
  name: string
  hex: string
  textClass?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-20 w-full border border-black/5"
        style={{ backgroundColor: hex }}
        title={hex}
      />
      <p className={`text-xs font-semibold ${textClass}`}>{name}</p>
      <p className="text-sage font-mono text-[11px]">{hex}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-gold/20 border-t py-14">
      <p className="text-bronze mb-8 flex items-center gap-3 text-xs font-semibold tracking-[0.28em] uppercase">
        <span aria-hidden className="h-px w-8 bg-current opacity-70" />
        {title}
      </p>
      {children}
    </section>
  )
}

export default function StyleguidePage() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-16 md:px-12">
      {/* Header */}
      <div className="border-gold/40 bg-champagne text-bronze mb-4 inline-flex items-center gap-2 border px-4 py-1.5 text-[11px] font-semibold tracking-[0.22em] uppercase">
        Hidden page — not linked from the site
      </div>
      <h1 className="text-forest mt-6 font-serif text-[clamp(2.5rem,6vw,4.5rem)] leading-none">
        Design tokens
        <br />
        <em className="text-bronze">& style guide</em>
      </h1>
      <p className="text-sage mt-4 max-w-xl text-base leading-relaxed">
        Single reference for every colour, font and motion value used across all apps. Update{' '}
        <code className="bg-sand rounded px-1 py-0.5 text-sm">lib/tokens.ts</code> and{' '}
        <code className="bg-sand rounded px-1 py-0.5 text-sm">app/globals.css</code> together.
      </p>

      {/* Colours */}
      <Section title="Colour palette">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 lg:grid-cols-5">
          <Swatch name="Forest" hex={colors.forest} textClass="text-ivory" />
          <Swatch name="Gold" hex={colors.gold} />
          <Swatch name="Bronze" hex={colors.bronze} textClass="text-ivory" />
          <Swatch name="Ivory" hex={colors.ivory} />
          <Swatch name="Champagne" hex={colors.champagne} />
          <Swatch name="Sand" hex={colors.sand} />
          <Swatch name="Ink" hex={colors.ink} textClass="text-ivory" />
          <Swatch name="Sage" hex={colors.sage} textClass="text-ivory" />
          <Swatch name="Error" hex={colors.error} textClass="text-ivory" />
          <Swatch name="Success" hex={colors.success} textClass="text-ivory" />
        </div>
      </Section>

      {/* Typography */}
      <Section title="Typography">
        <div className="space-y-10">
          <div>
            <p className="text-sage mb-2 font-mono text-xs">
              {fonts.serif} — headings, editorial, quotes
            </p>
            <p className="text-forest font-serif text-[clamp(2rem,5vw,4rem)] leading-none">
              A single-origin oil, pressed slowly.
            </p>
          </div>
          <div>
            <p className="text-sage mb-2 font-mono text-xs">{fonts.serif} — italic variant</p>
            <p className="text-forest font-serif text-[clamp(1.75rem,4vw,3rem)] leading-none italic">
              <em>From seed to bottle, nothing else.</em>
            </p>
          </div>
          <div>
            <p className="text-sage mb-2 font-mono text-xs">{fonts.sans} — body, UI, labels</p>
            <p className="text-ink text-lg leading-relaxed">
              Whole seeds, pressed slowly, never bleached or deodorised. Small batches with the
              pressing date on every bottle.
            </p>
          </div>
          <div>
            <p className="text-sage mb-2 font-mono text-xs">
              Eyebrow — xs, semibold, tracking-[0.28em], uppercase
            </p>
            <p className="text-bronze flex items-center gap-3 text-xs font-semibold tracking-[0.28em] uppercase">
              <span aria-hidden className="h-px w-8 bg-current opacity-70" />
              Section label
            </p>
          </div>
          <div>
            <p className="text-sage mb-2 font-mono text-xs">{fonts.tamil} — Tamil script</p>
            <p lang="ta" className="font-tamil text-sage text-xl">
              கடலை எண்ணெய் · நல்லெண்ணெய் · தேங்காய் எண்ணெய்
            </p>
          </div>
        </div>
      </Section>

      {/* Motion */}
      <Section title="Motion tokens">
        <dl className="grid gap-4 sm:grid-cols-2">
          {Object.entries(motion).map(([key, val]) => (
            <div key={key} className="border-gold/20 bg-champagne/40 border px-5 py-4">
              <dt className="text-sage font-mono text-xs">{key}</dt>
              <dd className="text-forest mt-1 text-sm font-medium">{val}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sage mt-6 text-sm">
          Use GSAP for scroll scenes, Motion (Framer) for small UI interactions. Never add a third
          animation library. Always respect{' '}
          <code className="bg-sand rounded px-1 py-0.5 text-xs">prefers-reduced-motion</code>.
        </p>
      </Section>

      {/* UI Components */}
      <Section title="UI components (reuse these)">
        <div className="space-y-8">
          {/* Buttons */}
          <div>
            <p className="text-sage mb-4 font-mono text-xs">Buttons</p>
            <div className="flex flex-wrap gap-4">
              <button className="bg-forest text-ivory hover:bg-ink inline-flex min-h-12 items-center px-8 text-[12px] font-semibold tracking-[0.2em] uppercase transition-colors">
                Primary
              </button>
              <button className="border-forest/30 text-forest hover:border-forest hover:bg-forest hover:text-ivory inline-flex min-h-12 items-center border px-8 text-[12px] font-semibold tracking-[0.2em] uppercase transition-colors">
                Secondary
              </button>
              <button className="bg-gold text-forest hover:bg-champagne inline-flex min-h-12 items-center px-8 text-[12px] font-semibold tracking-[0.2em] uppercase transition-colors">
                Gold accent
              </button>
            </div>
          </div>

          {/* Size selector */}
          <div>
            <p className="text-sage mb-4 font-mono text-xs">Size selector (radio pattern)</p>
            <div className="flex flex-wrap gap-2">
              {['500 ml', '1 L', '5 L'].map((s) => (
                <span
                  key={s}
                  className="border-forest/30 text-forest first:border-forest first:bg-forest first:text-ivory flex min-h-11 min-w-[4.5rem] items-center justify-center border px-4 text-sm"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Badge */}
          <div>
            <p className="text-sage mb-4 font-mono text-xs">Status badges</p>
            <div className="flex flex-wrap gap-3">
              <span className="border-gold/40 bg-champagne text-bronze inline-flex items-center border px-3 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase">
                Sample data
              </span>
              <span className="border-error/40 bg-errorBg text-error inline-flex items-center border px-3 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase">
                Only 3 left
              </span>
              <span className="border-sage/30 bg-sand text-sage inline-flex items-center border px-3 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase">
                Sold out
              </span>
            </div>
          </div>

          {/* Input */}
          <div>
            <p className="text-sage mb-4 font-mono text-xs">Text input</p>
            <input
              type="text"
              placeholder="Placeholder text"
              className="border-forest/25 text-ink placeholder:text-sage/60 focus:border-forest block w-full max-w-sm border bg-transparent px-4 py-3 text-sm focus:outline-none"
            />
          </div>
        </div>
      </Section>

      {/* Rules */}
      <Section title="Design rules (enforced every phase)">
        <ol className="text-ink/85 space-y-3 text-sm leading-relaxed">
          <li>
            <strong className="text-forest">Reuse before creating.</strong> Inspect existing
            components, tokens and shadcn/ui primitives first. Only create a new component if
            nothing existing fits.
          </li>
          <li>
            <strong className="text-forest">
              Fonts: Cormorant Garamond (headings), Inter (body), Noto Sans Tamil (regional).
            </strong>{' '}
            No new families. No new weights beyond those already loaded.
          </li>
          <li>
            <strong className="text-forest">Colours: only the tokens above.</strong> No new hex
            values. Error/success states use the named tokens, never ad-hoc reds or greens.
          </li>
          <li>
            <strong className="text-forest">Mood: luxury, editorial, calm.</strong> Generous
            spacing, thin hairlines, soft rounding, minimal ornament.
          </li>
          <li>
            <strong className="text-forest">Glass blur: header and cart drawer only.</strong> Don't
            apply backdrop-blur elsewhere without approval.
          </li>
          <li>
            <strong className="text-forest">Motion: GSAP for scroll, Motion for UI.</strong> No
            third library. All animations respect prefers-reduced-motion.
          </li>
          <li>
            <strong className="text-forest">Every new page needs a design-consistency check</strong>{' '}
            in its phase summary (new elements, tokens reused, nothing new introduced).
          </li>
        </ol>
      </Section>
    </div>
  )
}
