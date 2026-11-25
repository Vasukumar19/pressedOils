import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/oil/legal-page-shell'
import { fetchPublicSettings } from '@/lib/api'
import { canRenderDraftLegalCopy } from '@/lib/legal'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Shipping, Returns & Refunds',
  description: 'Shipping zones, transit timelines, damaged-bottle replacements, and refund terms.',
}

export default async function ShippingReturnsPage() {
  const settings = await fetchPublicSettings()
  const showDraft = canRenderDraftLegalCopy(settings)

  return (
    <LegalPageShell
      title="Shipping, Returns & Refunds"
      settings={settings}
      showDraftCopy={showDraft}
    >
      <p>
        TODO(owner): Replace this placeholder shipping and replacement policy with finalised
        courier, damage-claim, and refund turnaround commitments prior to launch.
      </p>
      <h2 className="font-serif text-2xl font-medium">Dispatch &amp; Store Pickup</h2>
      <p>
        Estimated delivery transit times and pincode shipping fees are displayed dynamically before
        checkout. Eligible orders placed for Store Pickup incur ₹0 shipping and require presenting
        the 6-digit pickup code at collection.
      </p>
      <h2 className="font-serif text-2xl font-medium">Damaged transit &amp; automatic refunds</h2>
      <p>
        If a late payment is captured after a 15-minute checkout hold expires and stock has sold
        out, our system automatically initiates a full refund to the original payment method.
      </p>
    </LegalPageShell>
  )
}
