import { Fragment, type ReactNode } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

/** Highlights [BRACKETED] placeholders so missing information is never hidden. */
export function Ph({ children }: { children: string }) {
  const parts = children.split(/(\[[^\]]+\])/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('[') ? (
          <span key={i} className="ph">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** Headline split into lines that are revealed through a mask. */
export function MaskLines({
  lines,
  manual = false,
}: {
  lines: ReactNode[]
  manual?: boolean
}) {
  return (
    <span data-mask={manual ? undefined : ''} className="block">
      {lines.map((line, i) => (
        <span key={i} className="mask-line">
          <span className="mask-inner">{line}</span>
        </span>
      ))}
    </span>
  )
}

export function Eyebrow({
  children,
  tone = 'light',
  className,
}: {
  children: ReactNode
  tone?: 'light' | 'dark'
  className?: string
}) {
  return (
    <p
      data-reveal
      className={cn(
        'flex items-center gap-3 text-xs font-medium uppercase tracking-[0.28em]',
        'text-bronze',
        className,
      )}
    >
      <span aria-hidden className="h-px w-8 shrink-0 bg-current opacity-70" />
      <span>{children}</span>
    </p>
  )
}

interface MediaFrameProps {
  src?: string | null
  alt: string
  caption?: string
  tag?: string | null
  className?: string
  sizes?: string
  priority?: boolean
  clip?: boolean
  parallax?: number
  zoomOnHover?: boolean
  captionClassName?: string
}

/** Photograph with the exact placeholder caption; falls back to a designed placeholder when no image exists. */
export function MediaFrame({
  src,
  alt,
  caption,
  tag = 'MEDIA PLACEHOLDER',
  className,
  sizes = '(min-width: 1024px) 50vw, 100vw',
  priority,
  clip,
  parallax,
  zoomOnHover,
  captionClassName,
}: MediaFrameProps) {
  return (
    <figure
      data-clip={clip ? '' : undefined}
      className={cn('relative isolate overflow-hidden bg-sand', className)}
    >
      <div data-clip-inner className="absolute inset-0">
        {src ? (
          <div
            data-parallax={parallax ? String(parallax) : undefined}
            className={cn('absolute', parallax ? '-inset-[10%]' : 'inset-0')}
          >
            <Image
              src={src}
              alt={alt}
              fill
              sizes={sizes}
              priority={priority}
              className={cn(
                'object-cover',
                zoomOnHover &&
                  'transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06]',
              )}
            />
          </div>
        ) : (
          <div
            role="img"
            aria-label={alt}
            className="pattern-lines absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_30%_20%,#fcf9f3_0%,#e9ddc6_80%)] p-8 text-center"
          >
            <span className="h-px w-10 bg-gold/70" />
            <span className="font-serif font-medium text-2xl italic leading-tight text-forest/90 md:text-3xl">
              {caption}
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.3em] text-bronze">
              {tag}
            </span>
          </div>
        )}
      </div>
      {src && caption ? (
        <figcaption
          className={cn(
            'absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] bg-ivory/85 px-2.5 py-1.5 text-xs font-medium uppercase leading-snug tracking-[0.16em] text-forest backdrop-blur-sm',
            captionClassName,
          )}
        >
          {caption}
          {tag ? <span className="text-bronze"> · {tag}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  )
}

/** Illustrative bottle used in the hero. Not a photograph of a real product. */
export function BottleIllustration({
  title = 'Groundnut',
  className,
}: {
  title?: string
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 240 520"
      role="img"
      aria-label={`Illustration of a ${title} oil bottle`}
      className={className}
    >
      <defs>
        <linearGradient id="b-oil" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#b9801c" />
          <stop offset="0.3" stopColor="#f2c85b" />
          <stop offset="0.62" stopColor="#e3a92f" />
          <stop offset="1" stopColor="#a56d10" />
        </linearGradient>
        <linearGradient id="b-oil-v" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#6b4308" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="b-glass" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="0.2" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="0.8" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="b-gold" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#8d6a25" />
          <stop offset="0.25" stopColor="#e9d193" />
          <stop offset="0.5" stopColor="#fbf0c9" />
          <stop offset="0.75" stopColor="#c8a24e" />
          <stop offset="1" stopColor="#7d5c1d" />
        </linearGradient>
        <radialGradient id="b-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#6b4a14" stopOpacity="0.38" />
          <stop offset="1" stopColor="#6b4a14" stopOpacity="0" />
        </radialGradient>
        <clipPath id="b-body">
          <path d="M96 96 C96 124 38 140 38 196 L38 468 Q38 494 64 494 L176 494 Q202 494 202 468 L202 196 C202 140 144 124 144 96 Z" />
        </clipPath>
      </defs>

      <ellipse cx="120" cy="502" rx="96" ry="12" fill="url(#b-shadow)" />

      <rect x="92" y="10" width="56" height="52" rx="6" fill="url(#b-gold)" />
      <g stroke="#7d5c1d" strokeOpacity="0.28" strokeWidth="1">
        {[18, 26, 34, 42, 50].map((y) => (
          <line key={y} x1="92" x2="148" y1={y} y2={y} />
        ))}
      </g>
      <rect x="96" y="62" width="48" height="12" rx="2" fill="url(#b-gold)" />
      <rect x="98" y="74" width="44" height="26" fill="#f6ecd2" fillOpacity="0.55" />

      <g clipPath="url(#b-body)">
        <rect x="30" y="100" width="180" height="400" fill="#fffaf0" fillOpacity="0.55" />
        <rect x="30" y="150" width="180" height="350" fill="url(#b-oil)" />
        <rect x="30" y="150" width="180" height="350" fill="url(#b-oil-v)" />
        <ellipse cx="120" cy="150" rx="90" ry="7" fill="#f7d77a" opacity="0.9" />
      </g>
      <path
        d="M96 96 C96 124 38 140 38 196 L38 468 Q38 494 64 494 L176 494 Q202 494 202 468 L202 196 C202 140 144 124 144 96 Z"
        fill="url(#b-glass)"
        stroke="#fff"
        strokeOpacity="0.8"
        strokeWidth="1.2"
      />

      <rect x="50" y="250" width="140" height="170" fill="#fcf9f3" />
      <rect x="56" y="256" width="128" height="158" fill="none" stroke="#c3a265" strokeWidth="0.8" />
      <text
        x="120"
        y="286"
        textAnchor="middle"
        fontSize="8.5"
        letterSpacing="2.6"
        fill="#33291F"
        fontFamily="var(--font-inter), sans-serif"
        fontWeight="500"
      >
        [YOUR BRAND]
      </text>
      <line x1="98" x2="142" y1="300" y2="300" stroke="#c3a265" strokeWidth="0.8" />
      <text
        x="120"
        y="346"
        textAnchor="middle"
        fontSize="31"
        fontStyle="italic"
        fill="#2A2118"
        fontFamily="var(--font-cormorant), Georgia, serif"
      >
        {title}
      </text>
      <text
        x="120"
        y="370"
        textAnchor="middle"
        fontSize="6"
        letterSpacing="2"
        fill="#84652C"
        fontFamily="var(--font-inter), sans-serif"
      >
        COLD PRESSED
      </text>
      <text
        x="120"
        y="398"
        textAnchor="middle"
        fontSize="6"
        letterSpacing="1.2"
        fill="#6A5E4E"
        fontFamily="var(--font-inter), sans-serif"
      >
        BATCH [NO.] · [DATE]
      </text>

      <path d="M52 200 C50 260 50 380 54 466" stroke="#fff" strokeOpacity="0.75" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M190 220 C192 300 192 400 188 456" stroke="#fff" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  )
}

const SEEDS = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: 30 + ((i * 53 + 7) % 70),
  size: 4 + (i % 4) * 2,
  dur: 16 + (i % 5) * 4,
  delay: -(i * 1.9),
  dx: (i % 2 ? 1 : -1) * (24 + i * 4),
  dy: -(120 + (i % 4) * 50),
}))

export function SeedParticles() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      {SEEDS.map((s, i) => (
        <span
          key={i}
          className="seed"
          style={
            {
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size * 1.7,
              '--dur': `${s.dur}s`,
              '--delay': `${s.delay}s`,
              '--dx': `${s.dx}px`,
              '--dy': `${s.dy}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
