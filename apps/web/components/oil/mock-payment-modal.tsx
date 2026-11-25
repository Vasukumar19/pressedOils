'use client'

import { useEffect, useRef } from 'react'
import { formatPaiseToInr } from '@pressedoils/shared'
import { ShieldCheck, X } from 'lucide-react'

interface MockPaymentModalProps {
  orderNumber: string
  amountPaise: number
  isProcessing: boolean
  onSimulateSuccess: () => void
  onSimulateFailure: () => void
  onDismiss: () => void
}

export default function MockPaymentModal({
  orderNumber,
  amountPaise,
  isProcessing,
  onSimulateSuccess,
  onSimulateFailure,
  onDismiss,
}: MockPaymentModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) {
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isProcessing, onDismiss])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Test payment simulator"
      className="bg-forest/70 fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div className="border-gold/40 bg-ivory text-forest w-full max-w-md border p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-bronze text-[11px] font-semibold tracking-[0.22em] uppercase">
              Development &amp; Staging Simulator
            </p>
            <h2 className="mt-1 font-serif text-3xl font-medium">Test Payment Gateway</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            disabled={isProcessing}
            onClick={onDismiss}
            aria-label="Close payment window"
            className="hover:bg-gold/30 flex size-11 items-center justify-center disabled:opacity-40"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="border-forest/15 bg-champagne/50 mt-5 space-y-2 border p-4 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sage text-xs tracking-[0.16em] uppercase">Order</span>
            <span className="font-mono text-xs font-medium">{orderNumber}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sage text-xs tracking-[0.16em] uppercase">Payable</span>
            <span className="font-serif text-2xl font-medium tabular-nums">
              {formatPaiseToInr(amountPaise)}
            </span>
          </div>
          <p className="text-sage flex items-center gap-1.5 pt-1 text-xs">
            <ShieldCheck className="text-success size-4 shrink-0" aria-hidden />
            Uses server-verified HMAC signatures without exposing keys in production.
          </p>
        </div>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onSimulateSuccess}
            className="bg-forest text-ivory hover:bg-ink min-h-12 w-full px-5 text-xs font-semibold tracking-[0.2em] uppercase transition-colors disabled:opacity-50"
          >
            {isProcessing ? 'Verifying payment…' : 'Simulate payment success'}
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={onSimulateFailure}
            className="border-error/40 text-error hover:bg-error-bg min-h-11 w-full border px-5 text-xs font-semibold tracking-[0.18em] uppercase transition-colors disabled:opacity-50"
          >
            Simulate payment failure &amp; release stock
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={onDismiss}
            className="border-forest/25 text-sage hover:text-forest min-h-11 w-full border px-5 text-xs font-medium tracking-[0.16em] uppercase transition-colors disabled:opacity-50"
          >
            Cancel &amp; return to checkout
          </button>
        </div>
      </div>
    </div>
  )
}
