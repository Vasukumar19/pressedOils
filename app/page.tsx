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
import { FounderStory, TrustSection } from '@/components/oil/story-trust'
import { CartProvider } from '@/lib/cart'

export default function Page() {
  return (
    <CartProvider>
      <MotionProvider>
        <Navbar />
        <main>
          <HeroSection />
          <BatchLookup />
          <BrandTicker />
          <ComparisonSection />
          <ProcessSection />
          <FounderStory />
          <TrustSection />
          <KitchenGallery />
          <LabelGuide />
          <ProductSection />
          <GiftSection />
          <FaqSection />
          <ClosingCta />
        </main>
        <Footer />
        <CartDrawer />
      </MotionProvider>
    </CartProvider>
  )
}
