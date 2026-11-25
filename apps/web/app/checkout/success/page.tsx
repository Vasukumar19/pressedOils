import { Suspense } from 'react'
import type { Metadata } from 'next'
import { CartDrawer } from '@/components/oil/cart-drawer'
import { CheckoutSuccessClient } from '@/components/oil/checkout-success-client'
import { Footer } from '@/components/oil/closing-footer'
import { Navbar } from '@/components/oil/navbar'
import { fetchPublicSettings } from '@/lib/api'
import { CartProvider } from '@/lib/cart'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Order Confirmed',
  robots: { index: false, follow: false },
}

export default async function CheckoutSuccessPage() {
  const settings = await fetchPublicSettings()

  return (
    <CartProvider initialSettings={settings}>
      <Navbar />
      <CartDrawer />
      <main>
        <Suspense
          fallback={
            <div className="text-sage mx-auto max-w-2xl px-5 pt-32 pb-20 text-center text-sm">
              Loading order confirmation…
            </div>
          }
        >
          <CheckoutSuccessClient />
        </Suspense>
      </main>
      <Footer settings={settings} />
    </CartProvider>
  )
}
