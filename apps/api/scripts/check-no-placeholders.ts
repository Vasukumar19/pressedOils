import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { canActivateProduct, isPlaceholderUrl, SETTING_KEYS } from '@pressedoils/shared'

/**
 * CI & pre-launch safety check:
 * Fails if any active product in the database references a /placeholders/ URL
 * or lacks a valid image, price > 0, stock, active current batch, or required lab report.
 */
async function checkNoPlaceholders() {
  const prisma = new PrismaClient()
  try {
    const allowedReportDomains = (process.env.CDN_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

    const labReportSetting = await prisma.setting.findUnique({
      where: { key: SETTING_KEYS.REQUIRE_LAB_REPORT_FOR_ACTIVATION },
    })
    const requireLabReportForActivation =
      (labReportSetting?.value as { enabled?: boolean } | null)?.enabled ?? true

    const activeProducts = await prisma.product.findMany({
      where: { is_active: true },
      include: {
        images: true,
        variants: true,
        batches: true,
      },
    })

    const failures: string[] = []

    for (const product of activeProducts) {
      for (const img of product.images) {
        if (isPlaceholderUrl(img.url)) {
          failures.push(`Product "${product.slug}" references placeholder image: ${img.url}`)
        }
      }

      const check = canActivateProduct(
        {
          images: product.images.map((i) => ({ url: i.url })),
          variants: product.variants.map((v) => ({
            isActive: v.is_active,
            pricePaise: v.price_paise,
            stock: v.stock,
          })),
          batches: product.batches.map((b) => ({
            isActive: b.is_active,
            isCurrent: b.is_current,
            labReportUrl: b.lab_report_url,
          })),
        },
        {
          requireLabReportForActivation,
          allowedReportDomains,
        },
      )

      if (!check.allowed) {
        failures.push(
          `Product "${product.slug}" fails activation check: ${check.reasons.join('; ')}`,
        )
      }
    }

    const samplePickups = await prisma.pickupLocation.findMany({
      where: { is_sample: true },
    })
    for (const loc of samplePickups) {
      failures.push(`Sample pickup location exists in database: "${loc.name}" (${loc.id})`)
    }

    if (failures.length > 0) {
      console.error('❌  Production placeholder / readiness check failed:')
      for (const f of failures) console.error(`  - ${f}`)
      process.exit(1)
    }

    console.log(
      `✅  check:no-placeholders passed (${activeProducts.length} active product(s) checked)`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

checkNoPlaceholders().catch((err) => {
  console.error('❌  check:no-placeholders failed:', err)
  process.exit(1)
})
