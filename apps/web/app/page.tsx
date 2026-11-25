import { connection } from 'next/server'
import { BatchLookup } from '@/components/oil/batch-lookup'
import { BrandTicker } from '@/components/oil/brand-ticker'
import { CartDrawer } from '@/components/oil/cart-drawer'
import { ClosingCta, Footer } from '@/components/oil/closing-footer'
import { ComparisonSection } from '@/components/oil/comparison-section'
import { FaqSection, GiftSection } from '@/components/oil/gift-faq'
import { HeroSection } from '@/components/oil/hero-section'
import { KitchenGallery } from '@/components/oil/kitchen-gallery'
import { LabelGuide } from '@/components/oil/label-guide'
import { MotionProvider } from '@/components/oil/motion-provider'
import { Navbar } from '@/components/oil/navbar'
import { ProcessSection } from '@/components/oil/process-section'
import { ProductSection } from '@/components/oil/product-section'
import { FounderStory, TrustSection } from '@/components/oil/story-trust-section'
import { fetchPublicProducts, fetchPublicSettings } from '@/lib/api'
import { CartProvider } from '@/lib/cart'
import { getAllowedReportDomains, isStorefrontProdRuntime } from '@/lib/env'
import { resolveLabReportPresentation } from '@/lib/lab-report'

export const revalidate = 30

export default async function Page() {
  // Ensures `next build` skips prerendering `/` without requiring a live API server
  await connection()

  const [{ items: products }, settings] = await Promise.all([
    fetchPublicProducts({ sort: 'featured', page: 1, pageSize: 24 }),
    fetchPublicSettings(),
  ])

  const isProduction = isStorefrontProdRuntime()
  const allowedReportDomains = getAllowedReportDomains()
  const hasVerifiedLabReports = products.some(
    (p) =>
      resolveLabReportPresentation(p.currentBatch, { isProduction, allowedReportDomains })
        .status === 'verified',
  )

  return (
    <CartProvider initialProducts={products} initialSettings={settings}>
      <MotionProvider brandName={settings.brandName}>
        <Navbar
          brandName={settings.brandName}
          freeShippingThresholdPaise={settings.freeShippingThresholdPaise}
        />
        <main>
          <HeroSection />
          <BatchLookup
            products={products}
            settings={settings}
            isProduction={isProduction}
            allowedReportDomains={allowedReportDomains}
          />
          <BrandTicker />
          <ComparisonSection />
          <ProcessSection />
          <FounderStory brandName={settings.brandName} />
          <TrustSection
            settings={settings}
            hasVerifiedLabReports={hasVerifiedLabReports}
            isProduction={isProduction}
          />
          <KitchenGallery />
          <LabelGuide />
          <ProductSection products={products} />
          <GiftSection />
          <FaqSection />
          <ClosingCta />
        </main>
        <Footer settings={settings} />
        <CartDrawer />
      </MotionProvider>
    </CartProvider>
  )
}
