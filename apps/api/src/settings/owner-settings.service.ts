import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { AdminRole, type Prisma } from '@prisma/client'
import { type OwnerUpdateSettingsDto, SETTING_KEYS } from '@pressedoils/shared'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from './settings.service'

@Injectable()
export class OwnerSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  private async resolveOwnerAdmin(ownerEmail: string) {
    const normalizedEmail = ownerEmail.trim().toLowerCase()
    if (!normalizedEmail) {
      throw new ForbiddenException('Owner admin email is required')
    }

    const admin = await this.prisma.admin.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, role: true, is_active: true },
    })

    if (!admin || !admin.is_active || admin.role !== AdminRole.OWNER) {
      throw new ForbiddenException('Only active OWNER admins may modify store settings')
    }

    return admin
  }

  async updateOwnerSettings(ownerEmail: string, dto: OwnerUpdateSettingsDto) {
    const owner = await this.resolveOwnerAdmin(ownerEmail)
    const keysToRead: string[] = []
    if (dto.freeShipping) {
      keysToRead.push(SETTING_KEYS.FREE_SHIPPING_CONFIG, SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE)
    }
    if (dto.storePickup) keysToRead.push(SETTING_KEYS.STORE_PICKUP_CONFIG)
    if (dto.taxDisplay) keysToRead.push(SETTING_KEYS.TAX_DISPLAY_CONFIG)
    if (dto.cod) keysToRead.push(SETTING_KEYS.COD_CONFIG)
    if (dto.legalPages) keysToRead.push(SETTING_KEYS.LEGAL_PAGES_CONFIG)
    if (dto.autoConfirmPaidOrders) keysToRead.push(SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS)

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findMany({
        where: { key: { in: keysToRead } },
      })
      const existingMap = new Map(existing.map((r) => [r.key, r.value as Record<string, unknown>]))

      if (dto.freeShipping) {
        const prevCfg = existingMap.get(SETTING_KEYS.FREE_SHIPPING_CONFIG) ?? null
        const prevThreshold =
          typeof prevCfg?.thresholdPaise === 'number'
            ? prevCfg.thresholdPaise
            : typeof existingMap.get(SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE)?.amountPaise ===
                'number'
              ? (existingMap.get(SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE)!.amountPaise as number)
              : 99900

        const nextValue = {
          enabled: dto.freeShipping.enabled,
          thresholdPaise: dto.freeShipping.thresholdPaise ?? prevThreshold,
          startsAt:
            dto.freeShipping.startsAt !== undefined
              ? dto.freeShipping.startsAt
              : typeof prevCfg?.startsAt === 'string'
                ? prevCfg.startsAt
                : null,
          endsAt:
            dto.freeShipping.endsAt !== undefined
              ? dto.freeShipping.endsAt
              : typeof prevCfg?.endsAt === 'string'
                ? prevCfg.endsAt
                : null,
        }

        await tx.setting.upsert({
          where: { key: SETTING_KEYS.FREE_SHIPPING_CONFIG },
          update: { value: nextValue },
          create: { key: SETTING_KEYS.FREE_SHIPPING_CONFIG, value: nextValue },
        })
        await tx.setting.upsert({
          where: { key: SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE },
          update: { value: { amountPaise: nextValue.thresholdPaise } },
          create: {
            key: SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE,
            value: { amountPaise: nextValue.thresholdPaise },
          },
        })

        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'UPDATE_FREE_SHIPPING_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.FREE_SHIPPING_CONFIG,
            before: (prevCfg ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextValue as Prisma.InputJsonValue,
          },
        })
      }

      if (dto.storePickup) {
        const prevPickup = existingMap.get(SETTING_KEYS.STORE_PICKUP_CONFIG) ?? null
        const nextPickup = {
          enabled: dto.storePickup.enabled,
          payAtStoreEnabled:
            dto.storePickup.payAtStoreEnabled ??
            (typeof prevPickup?.payAtStoreEnabled === 'boolean'
              ? prevPickup.payAtStoreEnabled
              : false),
          holdWindowDays:
            dto.storePickup.holdWindowDays ??
            (typeof prevPickup?.holdWindowDays === 'number' ? prevPickup.holdWindowDays : 3),
        }

        await tx.setting.upsert({
          where: { key: SETTING_KEYS.STORE_PICKUP_CONFIG },
          update: { value: nextPickup },
          create: { key: SETTING_KEYS.STORE_PICKUP_CONFIG, value: nextPickup },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'UPDATE_STORE_PICKUP_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.STORE_PICKUP_CONFIG,
            before: (prevPickup ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextPickup as Prisma.InputJsonValue,
          },
        })
      }

      if (dto.taxDisplay) {
        const prevTaxDisplay = existingMap.get(SETTING_KEYS.TAX_DISPLAY_CONFIG) ?? null
        const nextTaxDisplay = { showTaxBreakdown: dto.taxDisplay.showTaxBreakdown }

        await tx.setting.upsert({
          where: { key: SETTING_KEYS.TAX_DISPLAY_CONFIG },
          update: { value: nextTaxDisplay },
          create: { key: SETTING_KEYS.TAX_DISPLAY_CONFIG, value: nextTaxDisplay },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'UPDATE_TAX_DISPLAY_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.TAX_DISPLAY_CONFIG,
            before: (prevTaxDisplay ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextTaxDisplay as Prisma.InputJsonValue,
          },
        })
      }

      if (dto.cod) {
        const prevCod = existingMap.get(SETTING_KEYS.COD_CONFIG) ?? null
        const nextCod = {
          enabled: dto.cod.enabled,
          feePaise:
            dto.cod.feePaise ?? (typeof prevCod?.feePaise === 'number' ? prevCod.feePaise : 0),
          maxOrderPaise:
            dto.cod.maxOrderPaise ??
            (typeof prevCod?.maxOrderPaise === 'number' ? prevCod.maxOrderPaise : 500000),
          maxActiveOrdersPerPhone:
            dto.cod.maxActiveOrdersPerPhone ??
            (typeof prevCod?.maxActiveOrdersPerPhone === 'number'
              ? prevCod.maxActiveOrdersPerPhone
              : 2),
        }

        await tx.setting.upsert({
          where: { key: SETTING_KEYS.COD_CONFIG },
          update: { value: nextCod },
          create: { key: SETTING_KEYS.COD_CONFIG, value: nextCod },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'UPDATE_COD_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.COD_CONFIG,
            before: (prevCod ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextCod as Prisma.InputJsonValue,
          },
        })
      }

      if (dto.legalPages) {
        const prevLegal = existingMap.get(SETTING_KEYS.LEGAL_PAGES_CONFIG) ?? null
        const nextLegal = {
          approved: dto.legalPages.approved,
          privacyVersion:
            dto.legalPages.privacyVersion ??
            (typeof prevLegal?.privacyVersion === 'string'
              ? prevLegal.privacyVersion
              : '2026-11-draft-v1'),
          termsVersion:
            dto.legalPages.termsVersion ??
            (typeof prevLegal?.termsVersion === 'string'
              ? prevLegal.termsVersion
              : '2026-11-draft-v1'),
          shippingPolicyVersion:
            dto.legalPages.shippingPolicyVersion ??
            (typeof prevLegal?.shippingPolicyVersion === 'string'
              ? prevLegal.shippingPolicyVersion
              : '2026-11-draft-v1'),
        }

        await tx.setting.upsert({
          where: { key: SETTING_KEYS.LEGAL_PAGES_CONFIG },
          update: { value: nextLegal },
          create: { key: SETTING_KEYS.LEGAL_PAGES_CONFIG, value: nextLegal },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'UPDATE_LEGAL_PAGES_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.LEGAL_PAGES_CONFIG,
            before: (prevLegal ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextLegal as Prisma.InputJsonValue,
          },
        })
      }

      if (dto.autoConfirmPaidOrders) {
        const prevAutoConfirm = existingMap.get(SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS) ?? null
        const nextAutoConfirm = { enabled: dto.autoConfirmPaidOrders.enabled }

        await tx.setting.upsert({
          where: { key: SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS },
          update: { value: nextAutoConfirm },
          create: { key: SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS, value: nextAutoConfirm },
        })
        await tx.auditLog.create({
          data: {
            admin_id: owner.id,
            action: 'UPDATE_AUTO_CONFIRM_PAID_ORDERS_SETTING',
            entity: 'setting',
            entity_id: SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS,
            before: (prevAutoConfirm ?? undefined) as Prisma.InputJsonValue | undefined,
            after: nextAutoConfirm as Prisma.InputJsonValue,
          },
        })
      }
    })

    await this.settingsService.invalidateCache()
    return this.settingsService.getPublicSettings()
  }

  async setPickupLocationActive(ownerEmail: string, locationId: string, isActive: boolean) {
    const owner = await this.resolveOwnerAdmin(ownerEmail)
    const location = await this.prisma.pickupLocation.findUnique({ where: { id: locationId } })
    if (!location) {
      throw new NotFoundException('Pickup location not found')
    }
    if (this.settingsService.isProdRuntime() && location.is_sample && isActive) {
      throw new BadRequestException('Sample pickup locations cannot be activated in production')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.pickupLocation.update({
        where: { id: locationId },
        data: { is_active: isActive },
      })
      await tx.auditLog.create({
        data: {
          admin_id: owner.id,
          action: isActive ? 'ACTIVATE_PICKUP_LOCATION' : 'DEACTIVATE_PICKUP_LOCATION',
          entity: 'pickup_location',
          entity_id: locationId,
          before: { is_active: location.is_active },
          after: { is_active: isActive },
        },
      })
    })

    await this.settingsService.invalidateCache()
  }
}
