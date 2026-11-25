import 'dotenv/config'
import { AdminRole, PrismaClient } from '@prisma/client'
import { SETTING_KEYS } from '@pressedoils/shared'

/**
 * Production bootstrap: creates ONLY what the system needs to start:
 *  - First OWNER admin account (owner sets password on first login; must_set_password = true)
 *  - Default settings (placeholder store config to be filled in Admin UI)
 *  - ZERO products, ZERO variants, ZERO batches, ZERO placeholder images.
 */
async function bootstrapProd() {
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  if (!adminEmail) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL is required to run bootstrap:prod')
  }

  const prisma = new PrismaClient()
  try {
    await prisma.admin.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        password_hash: null,
        must_set_password: true,
        role: AdminRole.OWNER,
        is_active: true,
      },
    })

    const defaultSettings: Array<{ key: string; value: object }> = [
      { key: SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE, value: { amountPaise: 99900 } },
      {
        key: SETTING_KEYS.FREE_SHIPPING_CONFIG,
        value: { enabled: false, thresholdPaise: 99900, startsAt: null, endsAt: null },
      },
      { key: SETTING_KEYS.DEFAULT_SHIPPING_PAISE, value: { amountPaise: 7000 } },
      {
        key: SETTING_KEYS.GST_CONFIG,
        value: {
          rateBps: 500,
          includedInPrice: true,
          hsnCode: 'TODO(owner)',
          shippingTaxRateBps: null,
          isSample: false,
        },
      },
      {
        key: SETTING_KEYS.TAX_DISPLAY_CONFIG,
        value: { showTaxBreakdown: false },
      },
      {
        key: SETTING_KEYS.STORE_PICKUP_CONFIG,
        value: { enabled: false, payAtStoreEnabled: false, holdWindowDays: 3 },
      },
      {
        key: SETTING_KEYS.COD_CONFIG,
        value: {
          enabled: false,
          feePaise: 0,
          maxOrderPaise: 500000,
          maxActiveOrdersPerPhone: 2,
        },
      },
      {
        key: SETTING_KEYS.LEGAL_PAGES_CONFIG,
        value: {
          approved: false,
          privacyVersion: '2026-11-draft-v1',
          termsVersion: '2026-11-draft-v1',
          shippingPolicyVersion: '2026-11-draft-v1',
        },
      },
      {
        key: SETTING_KEYS.STORE_INFO,
        value: {
          brandName: '[YOUR BRAND]',
          fssaiNumber: 'TODO(owner)',
          supportEmail: 'TODO(owner)',
          supportPhone: 'TODO(owner)',
          registeredAddress: 'TODO(owner)',
        },
      },
      { key: SETTING_KEYS.REQUIRE_LAB_REPORT_FOR_ACTIVATION, value: { enabled: true } },
      { key: SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS, value: { enabled: true } },
    ]

    for (const s of defaultSettings) {
      await prisma.setting.upsert({
        where: { key: s.key },
        update: {},
        create: { key: s.key, value: s.value },
      })
    }

    console.log(`✅  bootstrap:prod completed (owner: ${adminEmail}, 0 products created)`)
  } finally {
    await prisma.$disconnect()
  }
}

bootstrapProd().catch((err) => {
  console.error('❌  bootstrap:prod failed:', err)
  process.exit(1)
})
