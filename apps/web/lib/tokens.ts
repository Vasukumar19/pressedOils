/**
 * Design tokens for [YOUR BRAND] storefront.
 *
 * These values mirror the @theme inline block in app/globals.css
 * and serve as the single reference for colours, typography and
 * spacing decisions across all apps in the monorepo.
 *
 * Rules:
 *  1. Never hard-code hex values in components — reference CSS variables.
 *  2. Never introduce a new colour not listed here without updating
 *     both this file and globals.css.
 *  3. Keep gold as an accent only, not a large fill.
 */

export const colors = {
  /** Deep forest green — primary text, buttons, borders */
  forest: '#2a2118',
  /** Antique gold — accent, dividers, CTA highlights */
  gold: '#c3a265',
  /** Warm bronze — eyebrows, secondary accents */
  bronze: '#6f5222',
  /** Off-white ivory — primary background */
  ivory: '#fcf9f3',
  /** Warm champagne — section backgrounds, hover states */
  champagne: '#f3ebdb',
  /** Sand — subtle section dividers */
  sand: '#e9ddc6',
  /** Dark warm ink — body text */
  ink: '#33291f',
  /** Muted sage — supporting text, captions */
  sage: '#6a5e4e',

  /* Semantic additions — keep in harmony with palette */
  /** Error / destructive state — dark warm red */
  error: '#8b2f2f',
  errorBg: '#fdf3f3',
  /** Success state — dark forest green variant */
  success: '#2f5c3f',
  successBg: '#f0f7f2',
} as const

export const fonts = {
  /** Headings, quotes, editorial display text */
  serif: 'Cormorant Garamond',
  /** Body text, UI labels, navigation */
  sans: 'Inter',
  /** Tamil / regional script lines */
  tamil: 'Noto Sans Tamil',
} as const

export const motion = {
  /** Large section reveals — slow and graceful */
  durationLg: '900ms',
  /** Small UI feedback (toast, button, badge) */
  durationSm: '250ms',
  /** Standard easing for all reveals */
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** GSAP equivalent: power3.out */
  easeGsap: 'power3.out',
} as const
