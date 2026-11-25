import type { Metadata } from 'next'
import { CartDrawer } from '@/components/oil/cart-drawer'
import { CheckoutClient } from '@/components/oil/checkout-client'
import { Footer } from '@/components/oil/closing-footer'
import { Navbar } from '@/components/oil/navbar'
import { fetchPublicSettings } from '@/lib/api'
import { CartProvider } from '@/lib/cart'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Review your delivery details, payment option, and order summary.',
  robots: { index: false, follow: false },
}

export default async function CheckoutPage() {
  const settings = await fetchPublicSettings()

  return (
    <CartProvider initialSettings={settings}>
      <Navbar />
      <CartDrawer />
      <main>
        <CheckoutClient />
      </main>
      <Footer settings={settings} />
    </CartProvider>
  )
}
