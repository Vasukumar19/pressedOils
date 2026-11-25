import type { PublicBatchDto } from '@pressedoils/shared'
import { describe, expect, it } from 'vitest'
import { resolveLabReportPresentation } from './lab-report'

const BASE_BATCH: PublicBatchDto = {
  batchNo: 'GND-2026-01',
  pressedOn: '2026-01-15',
  pressedOnDisplay: '15 Jan 2026',
  bestBefore: '2026-10-15',
  bestBeforeDisplay: '15 Oct 2026',
  labReportUrl: null,
  labTestedOn: null,
  labTestedOnDisplay: null,
}

describe('resolveLabReportPresentation', () => {
  it('shows pending copy without lab-tested claim in dev/staging when URL is missing or placeholder', () => {
    expect(
      resolveLabReportPresentation(BASE_BATCH, {
        isProduction: false,
        allowedReportDomains: ['cdn.example.com'],
      }),
    ).toEqual({
      showBatchSection: true,
      showLabTestedClaim: false,
      status: 'pending',
      reportUrl: null,
      testedOnDisplay: null,
    })
  })

  it('completely hides lab report UI and claim in production when batch lacks a real report URL', () => {
    expect(
      resolveLabReportPresentation(BASE_BATCH, {
        isProduction: true,
        allowedReportDomains: ['cdn.example.com'],
      }),
    ).toEqual({
      showBatchSection: true,
      showLabTestedClaim: false,
      status: 'hidden',
      reportUrl: null,
      testedOnDisplay: null,
    })

    // Untrusted external URL or placeholder URL in production is also hidden
    expect(
      resolveLabReportPresentation(
        {
          ...BASE_BATCH,
          labReportUrl: 'https://untrusted.example.org/fake.pdf',
          labTestedOn: '2026-01-18',
          labTestedOnDisplay: '18 Jan 2026',
        },
        {
          isProduction: true,
          allowedReportDomains: ['cdn.example.com'],
        },
      ),
    ).toEqual({
      showBatchSection: true,
      showLabTestedClaim: false,
      status: 'hidden',
      reportUrl: null,
      testedOnDisplay: null,
    })
  })

  it('displays verified PDF link and lab-tested badge when URL is HTTPS on trusted CDN domain', () => {
    const trustedBatch: PublicBatchDto = {
      ...BASE_BATCH,
      labReportUrl: 'https://cdn.example.com/reports/gnd-01.pdf',
      labTestedOn: '2026-01-18',
      labTestedOnDisplay: '18 Jan 2026',
    }

    expect(
      resolveLabReportPresentation(trustedBatch, {
        isProduction: true,
        allowedReportDomains: ['cdn.example.com'],
      }),
    ).toEqual({
      showBatchSection: true,
      showLabTestedClaim: true,
      status: 'verified',
      reportUrl: 'https://cdn.example.com/reports/gnd-01.pdf',
      testedOnDisplay: '18 Jan 2026',
    })
  })

  it('hides batch section completely when batch is null', () => {
    expect(
      resolveLabReportPresentation(null, {
        isProduction: true,
        allowedReportDomains: ['cdn.example.com'],
      }),
    ).toEqual({
      showBatchSection: false,
      showLabTestedClaim: false,
      status: 'hidden',
      reportUrl: null,
      testedOnDisplay: null,
    })
  })
})
