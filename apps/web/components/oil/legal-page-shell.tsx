import type { ReactNode } from 'react'
import Link from 'next/link'
import type { PublicSettingsResponseDto } from '@pressedoils/shared'
import { CartDrawer } from './cart-drawer'
import { Footer } from './closing-footer'
import { Navbar } from './navbar'
import { CartProvider } from '@/lib/cart'

interface LegalPageShellProps {
  title: string
  settings: PublicSettingsResponseDto
  showDraftCopy: boolean
  children: ReactNode
}

export function LegalPageShell({ title, settings, showDraftCopy, children }: LegalPageShellProps) {
  return (
    <CartProvider initialSettings={settings}>
      <Navbar />
      <CartDrawer />
      <main className="mx-auto max-w-3xl px-5 pt-32 pb-20">
        <Link
          href="/shop"
          className="text-sage hover:text-forest inline-flex min-h-11 items-center text-xs font-semibold tracking-[0.18em] uppercase"
        >
          ← Back to shop
        </Link>
        <h1 className="mt-2 font-serif text-4xl font-medium sm:text-5xl">{title}</h1>

        {showDraftCopy ? (
          <div className="text-ink/90 mt-8 space-y-6 text-sm leading-relaxed">
            {!settings.legalPagesApproved ? (
              <div className="border-gold/50 bg-champagne/60 text-forest border p-4 text-xs font-medium">
                [PLACEHOLDER DRAFT — Pending owner legal review before production launch (
                {settings.dpdpPolicyVersion}). Blocked automatically in production while{' '}
                <code>legal_pages_approved</code> is false.]
              </div>
            ) : null}
            {children}
          </div>
        ) : (
          <div className="border-forest/15 bg-champagne/40 text-sage mt-8 border p-6 text-sm leading-relaxed">
            This policy is currently being finalised prior to launch. Checkout stays disabled until
            published and approved by the store owner.
          </div>
        )}
      </main>
      <Footer settings={settings} />
    </CartProvider>
  )
}
