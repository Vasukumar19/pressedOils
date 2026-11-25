import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatPaiseToInr } from '@pressedoils/shared'
import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react'
import { CartDrawer } from '@/components/oil/cart-drawer'
import { Footer } from '@/components/oil/closing-footer'
import { Navbar } from '@/components/oil/navbar'
import { Eyebrow } from '@/components/oil/primitives'
import { ProductGallery } from '@/components/oil/product-gallery'
import { ProductPurchase } from '@/components/oil/product-purchase'
import { fetchPublicProductBySlug, fetchPublicSettings } from '@/lib/api'
import { CartProvider } from '@/lib/cart'
import { getAllowedReportDomains, isStorefrontProdRuntime } from '@/lib/env'
import { buildProductJsonLd } from '@/lib/json-ld'
import { resolveLabReportPresentation } from '@/lib/lab-report'

// On-demand ISR with 60s backstop; NO generateStaticParams so builds never depend on the API
export const revalidate = 60

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const [product, settings] = await Promise.all([
    fetchPublicProductBySlug(slug),
    fetchPublicSettings(),
  ])

  if (!product) {
    notFound()
  }

  return {
    title: `${product.name} — ${settings.brandName}`,
    description: `${product.description} Cold-pressed in small batches from ${product.originRegion}.`,
  }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const [product, settings] = await Promise.all([
    fetchPublicProductBySlug(slug),
    fetchPublicSettings(),
  ])

  if (!product) {
    notFound()
  }

  const isProduction = isStorefrontProdRuntime()
  const allowedReportDomains = getAllowedReportDomains()
  const labReport = resolveLabReportPresentation(product.currentBatch, {
    isProduction,
    allowedReportDomains,
  })
  const jsonLd = buildProductJsonLd(product, {
    isProduction,
    allowedReportDomains,
  })

  const startingPricePaise = product.variants[0]?.pricePaise ?? 0

  return (
    <CartProvider initialProducts={[product]} initialSettings={settings}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <Navbar
        brandName={settings.brandName}
        freeShippingThresholdPaise={settings.freeShippingThresholdPaise}
      />
      <main className="bg-ivory text-ink min-h-[100svh] pt-32 pb-24 md:pt-40">
        <div className="mx-auto max-w-[1400px] px-5 md:px-10">
          <nav aria-label="Breadcrumb" className="mb-8">
            <Link
              href="/shop"
              className="text-sage hover:text-forest inline-flex min-h-11 items-center gap-2 text-xs font-semibold tracking-[0.18em] uppercase transition-colors"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back to full shop
            </Link>
          </nav>

          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-6">
              <ProductGallery productName={product.name} images={product.images} />
            </div>

            <div className="lg:col-span-6">
              <Eyebrow>{product.originRegion}</Eyebrow>
              <h1 className="text-forest mt-5 font-serif text-5xl leading-[0.98] md:text-6xl">
                {product.name}
              </h1>
              <p className="text-bronze mt-4 text-sm font-medium tracking-[0.12em] uppercase">
                {product.bestFor}
              </p>
              <p className="text-ink/85 mt-6 text-base leading-relaxed md:text-lg">
                {product.description}
              </p>

              <div className="border-forest/15 mt-8 border-t pt-8">
                <ProductPurchase product={product} showMaxNote />
              </div>

              {settings.freeShippingThresholdPaise > 0 ? (
                <p className="text-sage mt-6 text-xs leading-relaxed">
                  {startingPricePaise >= settings.freeShippingThresholdPaise
                    ? 'This bottle qualifies for complimentary delivery.'
                    : `Free delivery on orders above ${formatPaiseToInr(settings.freeShippingThresholdPaise)}. Standard shipping ${formatPaiseToInr(settings.defaultShippingPaise)}.`}
                </p>
              ) : null}

              {labReport.showBatchSection && product.currentBatch ? (
                <section
                  aria-labelledby="batch-traceability-heading"
                  className="border-forest/20 bg-champagne/40 mt-10 border p-6 md:p-8"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2
                      id="batch-traceability-heading"
                      className="text-forest font-serif text-2xl font-medium"
                    >
                      Current batch traceability
                    </h2>
                    {labReport.showLabTestedClaim ? (
                      <span className="border-success/30 bg-success-bg text-success inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase">
                        <ShieldCheck className="size-3.5" aria-hidden />
                        Lab tested
                      </span>
                    ) : null}
                  </div>

                  <dl className="divide-forest/15 mt-5 divide-y font-mono text-[13px]">
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sage">Batch number</dt>
                      <dd className="text-forest font-medium">{product.currentBatch.batchNo}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sage">Pressed on</dt>
                      <dd className="text-forest">{product.currentBatch.pressedOnDisplay}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sage">Best before</dt>
                      <dd className="text-forest">{product.currentBatch.bestBeforeDisplay}</dd>
                    </div>

                    {labReport.status === 'verified' && labReport.reportUrl ? (
                      <>
                        {labReport.testedOnDisplay ? (
                          <div className="flex justify-between gap-4 py-3">
                            <dt className="text-sage">Lab tested on</dt>
                            <dd className="text-forest">{labReport.testedOnDisplay}</dd>
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between gap-4 py-3">
                          <dt className="text-sage">Lab report</dt>
                          <dd>
                            <a
                              href={labReport.reportUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-forest hover:text-bronze inline-flex min-h-11 items-center gap-1.5 font-sans text-xs font-semibold tracking-[0.16em] uppercase underline underline-offset-4"
                            >
                              Download report PDF
                              <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                          </dd>
                        </div>
                      </>
                    ) : labReport.status === 'pending' ? (
                      <div className="flex justify-between gap-4 py-3">
                        <dt className="text-sage">Lab report</dt>
                        <dd className="text-sage">Lab report pending upload</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </main>
      <Footer settings={settings} />
      <CartDrawer />
    </CartProvider>
  )
}
