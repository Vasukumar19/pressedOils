import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/oil/legal-page-shell'
import { fetchPublicSettings } from '@/lib/api'
import { canRenderDraftLegalCopy } from '@/lib/legal'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Privacy Policy (DPDP)',
  description: 'Privacy notice and customer data processing practices.',
}

export default async function PrivacyPage() {
  const settings = await fetchPublicSettings()
  const showDraft = canRenderDraftLegalCopy(settings)

  return (
    <LegalPageShell title="Privacy Policy" settings={settings} showDraftCopy={showDraft}>
      <p>
        TODO(owner): Replace this placeholder privacy policy with your reviewed Digital Personal
        Data Protection (DPDP Act, 2023) notice before enabling production checkout.
      </p>
      <h2 className="font-serif text-2xl font-medium">Data collected at checkout</h2>
      <p>
        We collect only your name, Indian mobile number, optional email address, and delivery
        address (omitted for store pickup orders) to fulfil orders, issue GST invoices, and share
        order status updates.
      </p>
      <h2 className="font-serif text-2xl font-medium">Payments &amp; retention</h2>
      <p>
        Online payments are processed securely via Razorpay. We never store card or UPI credentials
        on our servers. Contact <span className="font-mono">{settings.supportEmail}</span> for data
        correction or removal requests.
      </p>
    </LegalPageShell>
  )
}
