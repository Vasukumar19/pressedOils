import 'dotenv/config'
import { AdminRole, type Prisma, PrismaClient } from '@prisma/client'
import { SETTING_KEYS } from '@pressedoils/shared'

function readFlag(args: string[], prefix: string): string | undefined {
  const match = args.find((a) => a.startsWith(`${prefix}=`))
  return match ? match.slice(prefix.length + 1) : undefined
}

function parseBoolFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`Invalid boolean flag value: ${raw}`)
}

/**
 * CLI tool for OWNER admins to toggle pre-Phase-9 store settings with full AuditLog trails.
 * Usage example:
 *   pnpm --filter @pressedoils/api exec tsx scripts/set-owner-setting.ts \
 *     --email=owner-dev@example.invalid --free-shipping=true --threshold=99900
 */
async function main() {
  const args = process.argv.slice(2)
  const email = readFlag(args, '--email')?.trim().toLowerCase()
  if (!email) {
    throw new Error('--email=<owner-email> is required')
  }

  const freeShippingEnabled = parseBoolFlag(readFlag(args, '--free-shipping'))
  const thresholdRaw = readFlag(args, '--threshold')
  const storePickupEnabled = parseBoolFlag(readFlag(args, '--store-pickup'))
  const payAtStoreEnabled = parseBoolFlag(readFlag(args, '--pay-at-store'))
  const showTaxBreakdown = parseBoolFlag(readFlag(args, '--show-tax'))
  const codEnabled = parseBoolFlag(readFlag(args, '--cod'))
  const legalApproved = parseBoolFlag(readFlag(args, '--legal-approved'))
  const autoConfirmEnabled = parseBoolFlag(readFlag(args, '--auto-confirm'))

  if (
    freeShippingEnabled === undefined &&
    thresholdRaw === undefined &&
    storePickupEnabled === undefined &&
    payAtStoreEnabled === undefined &&
    showTaxBreakdown === undefined &&
    codEnabled === undefined &&
    legalApproved === undefined &&
    autoConfirmEnabled === undefined
  ) {
    throw new Error(
      'Provide at least one setting: --free-shipping, --threshold, --store-pickup, --pay-at-store, --show-tax, --cod, --legal-approved, or --auto-confirm',
    )
  }

  const prisma = new PrismaClient()
  try {
    const owner = await prisma.admin.findUnique({ where: { email } })
    if (!owner || !owner.is_active || owner.role !== AdminRole.OWNER) {
      throw new Error(`Admin "${email}" is not an active OWNER`)
    }

    await prisma.$transaction(async (tx) => {
      if (freeShippingEnabled !== undefined || thresholdRaw !== undefined) {
        const prev = await tx.setting.findUnique({
          where: { key: SETTING_KEYS.FREE_SHIPPING_CONFIG },
        })
        const prevVal = (prev?.value as Record<string, unknown> | undefined) ?? {}
        const thresholdPaise =
          thresholdRaw !== undefined
            ? Number(thresholdRaw)
            : typeof prevVal.thresholdPaise === 'number'
              ? prevVal.thresholdPaise
              : 99900

        if (!Number.isInteger(thresholdPaise) || thresholdPaise < 0) {
          throw new Error(`--threshold must be a non-negative integer in paise`)
        }

        const nextVal = {
          enabled:
            freeShippingEnabled ?? (typeof prevVal.enabled === 'boolean' ? prevVal.enabled : false),
          thresholdPaise,
          startsAt: typeof prevVal.startsAt === 'string' ? prevVal.startsAt : null,
          endsAt: typeof prevVal.endsAt === 'string' ? prevVal.endsAt : null,
        }

        await tx.setting.upsert({
          where: { key: SETTING_KEYS.FREE_SHIPPING_CONFIG },
          update: { value: nextVal },
          create: { key: SETTING_KEYS.FREE_SHIPPING_CONFIG, value: nextVal },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'CLI_UPDATE_FREE_SHIPPING_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.FREE_SHIPPING_CONFIG,
            before: (prev?.value ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextVal as Prisma.InputJsonValue,
          },
        })
      }

      if (storePickupEnabled !== undefined || payAtStoreEnabled !== undefined) {
        const prev = await tx.setting.findUnique({
          where: { key: SETTING_KEYS.STORE_PICKUP_CONFIG },
        })
        const prevVal = (prev?.value as Record<string, unknown> | undefined) ?? {}
        const nextVal = {
          enabled:
            storePickupEnabled ?? (typeof prevVal.enabled === 'boolean' ? prevVal.enabled : false),
          payAtStoreEnabled:
            payAtStoreEnabled ??
            (typeof prevVal.payAtStoreEnabled === 'boolean' ? prevVal.payAtStoreEnabled : false),
          holdWindowDays: typeof prevVal.holdWindowDays === 'number' ? prevVal.holdWindowDays : 3,
        }
        await tx.setting.upsert({
          where: { key: SETTING_KEYS.STORE_PICKUP_CONFIG },
          update: { value: nextVal },
          create: { key: SETTING_KEYS.STORE_PICKUP_CONFIG, value: nextVal },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'CLI_UPDATE_STORE_PICKUP_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.STORE_PICKUP_CONFIG,
            before: (prev?.value ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextVal as Prisma.InputJsonValue,
          },
        })
      }

      if (codEnabled !== undefined) {
        const prev = await tx.setting.findUnique({ where: { key: SETTING_KEYS.COD_CONFIG } })
        const prevVal = (prev?.value as Record<string, unknown> | undefined) ?? {}
        const nextVal = {
          enabled: codEnabled,
          feePaise: typeof prevVal.feePaise === 'number' ? prevVal.feePaise : 0,
          maxOrderPaise: typeof prevVal.maxOrderPaise === 'number' ? prevVal.maxOrderPaise : 500000,
          maxActiveOrdersPerPhone:
            typeof prevVal.maxActiveOrdersPerPhone === 'number'
              ? prevVal.maxActiveOrdersPerPhone
              : 2,
        }
        await tx.setting.upsert({
          where: { key: SETTING_KEYS.COD_CONFIG },
          update: { value: nextVal },
          create: { key: SETTING_KEYS.COD_CONFIG, value: nextVal },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'CLI_UPDATE_COD_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.COD_CONFIG,
            before: (prev?.value ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextVal as Prisma.InputJsonValue,
          },
        })
      }

      if (legalApproved !== undefined) {
        const prev = await tx.setting.findUnique({
          where: { key: SETTING_KEYS.LEGAL_PAGES_CONFIG },
        })
        const prevVal = (prev?.value as Record<string, unknown> | undefined) ?? {}
        const nextVal = {
          approved: legalApproved,
          privacyVersion:
            typeof prevVal.privacyVersion === 'string'
              ? prevVal.privacyVersion
              : '2026-11-draft-v1',
          termsVersion:
            typeof prevVal.termsVersion === 'string' ? prevVal.termsVersion : '2026-11-draft-v1',
          shippingPolicyVersion:
            typeof prevVal.shippingPolicyVersion === 'string'
              ? prevVal.shippingPolicyVersion
              : '2026-11-draft-v1',
        }
        await tx.setting.upsert({
          where: { key: SETTING_KEYS.LEGAL_PAGES_CONFIG },
          update: { value: nextVal },
          create: { key: SETTING_KEYS.LEGAL_PAGES_CONFIG, value: nextVal },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'CLI_UPDATE_LEGAL_PAGES_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.LEGAL_PAGES_CONFIG,
            before: (prev?.value ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextVal as Prisma.InputJsonValue,
          },
        })
      }

      if (showTaxBreakdown !== undefined) {
        const prev = await tx.setting.findUnique({
          where: { key: SETTING_KEYS.TAX_DISPLAY_CONFIG },
        })
        const nextVal = { showTaxBreakdown }
        await tx.setting.upsert({
          where: { key: SETTING_KEYS.TAX_DISPLAY_CONFIG },
          update: { value: nextVal },
          create: { key: SETTING_KEYS.TAX_DISPLAY_CONFIG, value: nextVal },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'CLI_UPDATE_TAX_DISPLAY_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.TAX_DISPLAY_CONFIG,
            before: (prev?.value ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextVal as Prisma.InputJsonValue,
          },
        })
      }

      if (autoConfirmEnabled !== undefined) {
        const prev = await tx.setting.findUnique({
          where: { key: SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS },
        })
        const nextVal = { enabled: autoConfirmEnabled }
        await tx.setting.upsert({
          where: { key: SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS },
          update: { value: nextVal },
          create: { key: SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS, value: nextVal },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'CLI_UPDATE_AUTO_CONFIRM_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS,
            before: (prev?.value ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextVal as Prisma.InputJsonValue,
          },
        })
      }
    })

    console.log('✅ Owner settings updated and audit logged.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('❌ set-owner-setting failed:', err)
  process.exit(1)
})
