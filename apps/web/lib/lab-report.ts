import { isTrustedLabReportUrl, type PublicBatchDto } from '@pressedoils/shared'

export type LabReportStatus = 'verified' | 'pending' | 'hidden'

export interface LabReportPresentation {
  showBatchSection: boolean
  showLabTestedClaim: boolean
  status: LabReportStatus
  reportUrl: string | null
  testedOnDisplay: string | null
}

/**
 * Resolves batch lab-report visibility and claim status:
 * - Valid trusted HTTPS CDN/storage URL -> show link + verified tested date across all envs
 * - Missing/placeholder URL in dev/staging -> show "Lab report pending upload" without claim
 * - Missing/placeholder URL in production -> completely hide report UI & any "lab tested" claim
 */
export function resolveLabReportPresentation(
  batch: PublicBatchDto | null,
  options: {
    isProduction: boolean
    allowedReportDomains: readonly string[]
  },
): LabReportPresentation {
  if (!batch) {
    return {
      showBatchSection: false,
      showLabTestedClaim: false,
      status: 'hidden',
      reportUrl: null,
      testedOnDisplay: null,
    }
  }

  if (isTrustedLabReportUrl(batch.labReportUrl, options.allowedReportDomains)) {
    return {
      showBatchSection: true,
      showLabTestedClaim: true,
      status: 'verified',
      reportUrl: batch.labReportUrl,
      testedOnDisplay: batch.labTestedOnDisplay,
    }
  }

  if (options.isProduction) {
    return {
      showBatchSection: true,
      showLabTestedClaim: false,
      status: 'hidden',
      reportUrl: null,
      testedOnDisplay: null,
    }
  }

  return {
    showBatchSection: true,
    showLabTestedClaim: false,
    status: 'pending',
    reportUrl: null,
    testedOnDisplay: null,
  }
}
