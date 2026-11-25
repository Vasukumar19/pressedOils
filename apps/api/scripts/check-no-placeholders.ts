import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { canActivateProduct, isPlaceholderUrl } from '@pressedoils/shared'

/**
 * CI & pre-launch safety check:
 * Fails if any active product in the database references a /placeholders/ URL
 * or lacks a valid image, price > 0, stock, or active current batch.
 */
async function checkNoPlaceholders() {
  const prisma = new PrismaClient()
  try {
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

      const check = canActivateProduct({
        images: product.images.map((i) => ({ url: i.url })),
        variants: product.variants.map((v) => ({
          isActive: v.is_active,
          pricePaise: v.price_paise,
          stock: v.stock,
        })),
        batches: product.batches.map((b) => ({
          isActive: b.is_active,
          isCurrent: b.is_current,
        })),
      })

      if (!check.allowed) {
        failures.push(
          `Product "${product.slug}" fails activation check: ${check.reasons.join('; ')}`,
        )
      }
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
