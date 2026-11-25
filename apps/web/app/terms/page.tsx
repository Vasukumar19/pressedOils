import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/oil/legal-page-shell'
import { fetchPublicSettings } from '@/lib/api'
import { canRenderDraftLegalCopy } from '@/lib/legal'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'Terms of sale and service for orders.',
}

export default async function TermsPage() {
  const settings = await fetchPublicSettings()
  const showDraft = canRenderDraftLegalCopy(settings)

  return (
    <LegalPageShell title="Terms & Conditions" settings={settings} showDraftCopy={showDraft}>
      <p>
        TODO(owner): Replace these placeholder terms with your reviewed commercial terms before
        setting <code>legal_pages_approved</code> to true in production.
      </p>
      <h2 className="font-serif text-2xl font-medium">Pricing &amp; stock reservations</h2>
      <p>
        All item prices are verified live from our servers in INR. Online checkout holds stock for
        15 minutes pending payment confirmation; uncaptured holds are automatically released.
      </p>
      <h2 className="font-serif text-2xl font-medium">Order fulfilment &amp; governing law</h2>
      <p>
        Orders are fulfilled directly by {settings.brandName} ({settings.registeredAddress}). Cash
        on Delivery and Store Pickup availability depend on pincode eligibility and store
        configuration.
      </p>
    </LegalPageShell>
  )
}
