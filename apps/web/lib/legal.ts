import type { PublicSettingsResponseDto } from '@pressedoils/shared'
import { isStorefrontProdRuntime } from './env'

export function canRenderDraftLegalCopy(settings: PublicSettingsResponseDto | undefined): boolean {
  if (!isStorefrontProdRuntime()) return true
  return Boolean(settings?.legalPagesApproved)
}
