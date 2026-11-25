import { ALERT_SEVERITY, type AlertSeverity, NOTIFICATION_EVENT } from '@pressedoils/shared'
import type { DltTemplateKey } from '../notification.types'

export const NOTIFICATION_TEMPLATE_VERSION = 'v1' as const

const BRAND_COLORS = {
  forest: '#1F3A2E',
  ivory: '#F7F3EA',
  champagne: '#F1EAD8',
  gold: '#C4A053',
  bronze: '#7A5D2E',
  ink: '#2C2621',
  sage: '#56645B',
  sand: '#E8E1D3',
} as const

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderBrandedEmailShell(input: {
  brandName: string
  supportEmail: string
  supportPhone: string
  heading: string
  preheader: string
  bodyHtml: string
}): string {
  const brand = escapeHtml(input.brandName)
  const heading = escapeHtml(input.heading)
  const preheader = escapeHtml(input.preheader)
  const supEmail = escapeHtml(input.supportEmail)
  const supPhone = escapeHtml(input.supportPhone)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_COLORS.sand};color:${BRAND_COLORS.ink};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:${BRAND_COLORS.ivory};border:1px solid #D5CEC0;">
          <tr>
            <td style="background-color:${BRAND_COLORS.forest};padding:24px 28px;border-bottom:2px solid ${BRAND_COLORS.gold};">
              <p style="margin:0;color:${BRAND_COLORS.gold};font-size:11px;letter-spacing:2.4px;text-transform:uppercase;font-weight:600;">Wood-Pressed Pure Oils</p>
              <p style="margin:6px 0 0;color:${BRAND_COLORS.ivory};font-family:'Cormorant Garamond',Georgia,serif;font-size:28px;font-weight:500;letter-spacing:0.4px;">${brand}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px;color:${BRAND_COLORS.forest};font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;font-weight:500;line-height:1.2;">${heading}</h1>
              ${input.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background-color:${BRAND_COLORS.champagne};border-top:1px solid #DCD4C2;color:${BRAND_COLORS.sage};font-size:12px;line-height:1.6;">
              Questions? Reach us at <strong>${supEmail}</strong> or <strong>${supPhone}</strong>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export interface CustomerTemplateInput {
  event: string
  brandName: string
  supportEmail: string
  supportPhone: string
  orderNumber: string
  totalFormatted?: string
  trackingUrl?: string | null
  pickupLocationName?: string | null
  pickupAddress?: string | null
  pickupHours?: string | null
  pickupCode?: string | null
  lastCollectionDate?: string | null
  amountFormatted?: string | null
  cumulativeRefundedFormatted?: string | null
}

export interface RenderedCustomerNotification {
  templateId: string
  templateVersion: string
  dltTemplateKey: DltTemplateKey
  smsBody: string
  smsVariables: Record<string, string>
  emailSubject: string
  emailHtml: string
  emailText: string
}

export function buildCustomerNotificationTemplate(
  input: CustomerTemplateInput,
): RenderedCustomerNotification {
  const b = input.brandName
  const ord = input.orderNumber

  switch (input.event) {
    case NOTIFICATION_EVENT.ORDER_PLACED_COD:
    case NOTIFICATION_EVENT.ORDER_CONFIRMED:
    case NOTIFICATION_EVENT.ORDER_PAID: {
      const isPickup = Boolean(input.pickupLocationName)
      const pickupNote = isPickup
        ? ` We'll send your pickup code when your order is ready at ${input.pickupLocationName}.`
        : ''
      const totalLine = input.totalFormatted ? ` (${input.totalFormatted})` : ''
      const heading = isPickup ? `Store pickup order confirmed` : `Order ${ord} confirmed`
      const smsBody = `${b}: Your order ${ord}${totalLine} is confirmed.${pickupNote}`
      const emailText = `Thank you for ordering with ${b}.\n\nOrder number: ${ord}${totalLine}\n${isPickup ? `Pickup store: ${input.pickupLocationName}\nWe'll send your pickup code when your order is ready.` : 'We are preparing your freshly milled oil batch for dispatch.'}`
      const emailHtml = renderBrandedEmailShell({
        brandName: b,
        supportEmail: input.supportEmail,
        supportPhone: input.supportPhone,
        heading,
        preheader: `Order ${ord} is confirmed`,
        bodyHtml: `
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Thank you for choosing <strong>${escapeHtml(b)}</strong>.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Order <strong style="font-family:monospace;">${escapeHtml(ord)}</strong>${escapeHtml(totalLine)} is confirmed.</p>
          ${
            isPickup
              ? `<div style="background-color:${BRAND_COLORS.champagne};border:1px solid ${BRAND_COLORS.gold};padding:14px 16px;margin:16px 0;font-size:13px;line-height:1.6;">
                   <p style="margin:0 0 4px;font-weight:600;color:${BRAND_COLORS.forest};">Pickup store: ${escapeHtml(input.pickupLocationName ?? '')}</p>
                   <p style="margin:0;color:${BRAND_COLORS.ink};">We'll send your pickup code by SMS and email when your order is ready for collection.</p>
                 </div>`
              : `<p style="margin:0;font-size:14px;color:${BRAND_COLORS.sage};">We will notify you again as soon as your bottles are packed and dispatched.</p>`
          }`,
      })

      return {
        templateId:
          input.event === NOTIFICATION_EVENT.ORDER_PLACED_COD
            ? 'order-placed-cod-v1'
            : input.event === NOTIFICATION_EVENT.ORDER_PAID
              ? 'order-paid-v1'
              : 'order-confirmed-v1',
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        dltTemplateKey: 'ORDER_CONFIRMED',
        smsBody,
        smsVariables: {
          var1: b,
          var2: ord,
          var3: input.totalFormatted ?? '',
        },
        emailSubject: `${b} — Order ${ord} confirmed`,
        emailHtml,
        emailText,
      }
    }

    case NOTIFICATION_EVENT.ORDER_PACKED: {
      const smsBody = `${b}: Order ${ord} has been freshly packed and is awaiting dispatch.`
      const emailText = `Your ${b} order ${ord} is packed and ready for dispatch.`
      const emailHtml = renderBrandedEmailShell({
        brandName: b,
        supportEmail: input.supportEmail,
        supportPhone: input.supportPhone,
        heading: `Order ${ord} packed`,
        preheader: `Your order ${ord} is packed`,
        bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6;">Your order <strong style="font-family:monospace;">${escapeHtml(ord)}</strong> is securely packed and queued for dispatch.</p>`,
      })
      return {
        templateId: 'order-packed-v1',
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        dltTemplateKey: 'ORDER_UPDATE',
        smsBody,
        smsVariables: { var1: b, var2: ord, var3: 'packed' },
        emailSubject: `${b} — Order ${ord} packed`,
        emailHtml,
        emailText,
      }
    }

    case NOTIFICATION_EVENT.ORDER_SHIPPED: {
      const trackInfo = input.trackingUrl ? ` Track: ${input.trackingUrl}` : ''
      const smsBody = `${b}: Order ${ord} has shipped.${trackInfo}`
      const emailText = `Your ${b} order ${ord} has been dispatched.${trackInfo}`
      const emailHtml = renderBrandedEmailShell({
        brandName: b,
        supportEmail: input.supportEmail,
        supportPhone: input.supportPhone,
        heading: `Order ${ord} shipped`,
        preheader: `Order ${ord} is on the way`,
        bodyHtml: `
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Great news — your order <strong style="font-family:monospace;">${escapeHtml(ord)}</strong> is on its way.</p>
          ${
            input.trackingUrl
              ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(input.trackingUrl)}" style="display:inline-block;background-color:${BRAND_COLORS.forest};color:${BRAND_COLORS.ivory};padding:12px 22px;text-decoration:none;font-size:12px;letter-spacing:1.8px;text-transform:uppercase;font-weight:600;">Track shipment</a></p>`
              : ''
          }`,
      })
      return {
        templateId: 'order-shipped-v1',
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        dltTemplateKey: 'ORDER_SHIPPED',
        smsBody,
        smsVariables: { var1: b, var2: ord, var3: input.trackingUrl ?? '' },
        emailSubject: `${b} — Order ${ord} shipped`,
        emailHtml,
        emailText,
      }
    }

    case NOTIFICATION_EVENT.ORDER_READY_FOR_PICKUP:
    case NOTIFICATION_EVENT.PICKUP_CODE_REISSUED: {
      const code = input.pickupCode ?? '******'
      const hours = input.pickupHours ?? 'Store hours'
      const lastDate = input.lastCollectionDate ?? 'within hold window'
      const loc = input.pickupLocationName ?? 'our store'
      const isReissue = input.event === NOTIFICATION_EVENT.PICKUP_CODE_REISSUED

      const smsBody = isReissue
        ? `${b}: New pickup code ${code} for order ${ord}. Collect by ${lastDate} (${hours}).`
        : `${b}: Order ${ord} is ready at ${loc}. Pickup code: ${code}. Collect by ${lastDate} (${hours}).`
      const emailText = [
        `${b} — Order ${ord} is ready for pickup at ${loc}.`,
        `Pickup code: ${code}`,
        input.pickupAddress ? `Address: ${input.pickupAddress}` : null,
        `Store hours: ${hours}`,
        `Collect before: ${lastDate}`,
        `Fallback if unavailable: carry your order number + government photo ID.`,
      ]
        .filter(Boolean)
        .join('\n')

      const emailHtml = renderBrandedEmailShell({
        brandName: b,
        supportEmail: input.supportEmail,
        supportPhone: input.supportPhone,
        heading: isReissue ? `New pickup code for ${ord}` : `Order ${ord} is ready for pickup`,
        preheader: `Pickup code ${code} — collect by ${lastDate}`,
        bodyHtml: `
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${
            isReissue
              ? `Here is your updated pickup code for order <strong style="font-family:monospace;">${escapeHtml(ord)}</strong> (previous codes are now invalid).`
              : `Your freshly packed bottles for order <strong style="font-family:monospace;">${escapeHtml(ord)}</strong> are ready at <strong>${escapeHtml(loc)}</strong>.`
          }</p>
          <div style="background-color:${BRAND_COLORS.champagne};border:1px solid ${BRAND_COLORS.gold};padding:18px 20px;margin:16px 0;">
            <p style="margin:0 0 6px;color:${BRAND_COLORS.bronze};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">6-Digit Pickup Code</p>
            <p style="margin:0;color:${BRAND_COLORS.forest};font-family:monospace;font-size:30px;font-weight:700;letter-spacing:6px;">${escapeHtml(code)}</p>
          </div>
          <p style="margin:0 0 6px;font-size:13px;"><strong>Store hours:</strong> ${escapeHtml(hours)}</p>
          ${input.pickupAddress ? `<p style="margin:0 0 6px;font-size:13px;"><strong>Address:</strong> ${escapeHtml(input.pickupAddress)}</p>` : ''}
          <p style="margin:0 0 10px;font-size:13px;"><strong>Collect by:</strong> ${escapeHtml(lastDate)}</p>
          <p style="margin:0;font-size:12px;color:${BRAND_COLORS.sage};">If you do not have access to this code at the counter, share order number ${escapeHtml(ord)} with photo ID.</p>`,
      })

      return {
        templateId: isReissue ? 'pickup-code-reissued-v1' : 'order-ready-pickup-v1',
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        dltTemplateKey: isReissue ? 'PICKUP_CODE' : 'ORDER_READY_FOR_PICKUP',
        smsBody,
        smsVariables: {
          var1: ord,
          var2: code,
          var3: lastDate,
          var4: hours,
        },
        emailSubject: isReissue
          ? `${b} — New pickup code for ${ord}`
          : `${b} — Order ${ord} ready for pickup`,
        emailHtml,
        emailText,
      }
    }

    case NOTIFICATION_EVENT.ORDER_DELIVERED: {
      const smsBody = `${b}: Order ${ord} has been delivered. Enjoy your freshly cold-pressed oils!`
      const emailText = `Your ${b} order ${ord} has been delivered.`
      const emailHtml = renderBrandedEmailShell({
        brandName: b,
        supportEmail: input.supportEmail,
        supportPhone: input.supportPhone,
        heading: `Order ${ord} delivered`,
        preheader: `Order ${ord} delivered`,
        bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6;">Your order <strong style="font-family:monospace;">${escapeHtml(ord)}</strong> has been delivered. Thank you for supporting small-batch wood-pressed oils.</p>`,
      })
      return {
        templateId: 'order-delivered-v1',
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        dltTemplateKey: 'ORDER_DELIVERED',
        smsBody,
        smsVariables: { var1: b, var2: ord },
        emailSubject: `${b} — Order ${ord} delivered`,
        emailHtml,
        emailText,
      }
    }

    case NOTIFICATION_EVENT.ORDER_PICKED_UP: {
      const smsBody = `${b}: Order ${ord} was collected at the store. Thank you!`
      const emailText = `Your ${b} order ${ord} has been picked up at the store.`
      const emailHtml = renderBrandedEmailShell({
        brandName: b,
        supportEmail: input.supportEmail,
        supportPhone: input.supportPhone,
        heading: `Order ${ord} collected`,
        preheader: `Store pickup complete for ${ord}`,
        bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6;">Your store pickup order <strong style="font-family:monospace;">${escapeHtml(ord)}</strong> has been handed over. Enjoy your fresh oils!</p>`,
      })
      return {
        templateId: 'order-picked-up-v1',
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        dltTemplateKey: 'ORDER_UPDATE',
        smsBody,
        smsVariables: { var1: b, var2: ord, var3: 'picked up' },
        emailSubject: `${b} — Order ${ord} collected`,
        emailHtml,
        emailText,
      }
    }

    case NOTIFICATION_EVENT.ORDER_PARTIALLY_REFUNDED:
    case NOTIFICATION_EVENT.ORDER_REFUNDED:
    case NOTIFICATION_EVENT.ORDER_LATE_OOS_REFUNDED: {
      const isPartial = input.event === NOTIFICATION_EVENT.ORDER_PARTIALLY_REFUNDED
      const isLateOos = input.event === NOTIFICATION_EVENT.ORDER_LATE_OOS_REFUNDED
      const amt = input.amountFormatted ?? 'your payment'
      const smsBody = isLateOos
        ? `${b}: Stock sold out before late payment completed on order ${ord}. Full refund (${amt}) initiated.`
        : isPartial
          ? `${b}: Partial refund (${amt}) processed for order ${ord}.`
          : `${b}: Full refund (${amt}) processed for order ${ord}.`
      const emailText = smsBody
      const emailHtml = renderBrandedEmailShell({
        brandName: b,
        supportEmail: input.supportEmail,
        supportPhone: input.supportPhone,
        heading: isPartial ? `Partial refund for ${ord}` : `Refund processed for ${ord}`,
        preheader: smsBody,
        bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6;">${escapeHtml(smsBody)} Credit to your original payment method settles in 5–7 working days.</p>`,
      })
      return {
        templateId: isLateOos
          ? 'order-late-oos-refund-v1'
          : isPartial
            ? 'order-partial-refund-v1'
            : 'order-refunded-v1',
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        dltTemplateKey: 'ORDER_UPDATE',
        smsBody,
        smsVariables: { var1: b, var2: ord, var3: amt },
        emailSubject: `${b} — Refund update for ${ord}`,
        emailHtml,
        emailText,
      }
    }

    case NOTIFICATION_EVENT.ORDER_CANCELLED:
    default: {
      const smsBody = `${b}: Order ${ord} has been cancelled. If prepaid, any eligible refund is initiated automatically.`
      const emailText = smsBody
      const emailHtml = renderBrandedEmailShell({
        brandName: b,
        supportEmail: input.supportEmail,
        supportPhone: input.supportPhone,
        heading: `Order ${ord} cancelled`,
        preheader: `Order ${ord} cancelled`,
        bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6;">Your order <strong style="font-family:monospace;">${escapeHtml(ord)}</strong> has been cancelled. Any online payment refund settles to your original method in 5–7 business days.</p>`,
      })
      return {
        templateId: 'order-cancelled-v1',
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        dltTemplateKey: 'ORDER_UPDATE',
        smsBody,
        smsVariables: { var1: b, var2: ord, var3: 'cancelled' },
        emailSubject: `${b} — Order ${ord} cancelled`,
        emailHtml,
        emailText,
      }
    }
  }
}

export function buildOtpSmsTemplate(input: {
  brandName: string
  code: string
  ttlMinutes: number
  purposeLabel: string
}): {
  templateId: string
  templateVersion: string
  smsBody: string
  variables: Record<string, string>
} {
  return {
    templateId: 'otp-verification-v1',
    templateVersion: NOTIFICATION_TEMPLATE_VERSION,
    smsBody: `${input.brandName}: Your ${input.purposeLabel} OTP is ${input.code}. Valid for ${input.ttlMinutes} minutes. Do not share it.`,
    variables: {
      var1: input.code,
      var2: String(input.ttlMinutes),
      var3: input.purposeLabel,
    },
  }
}

export function buildOwnerAlertTemplate(input: {
  brandName: string
  alertKey: string
  severity: AlertSeverity
  orderNumber?: string | null
  reason: string
  occurrenceCount: number
  supportEmail: string
  supportPhone: string
}) {
  const countSuffix = input.occurrenceCount > 1 ? ` (repeated ${input.occurrenceCount}x)` : ''
  const orderRef = input.orderNumber ? `Order ${input.orderNumber}: ` : ''
  const safeSummary = `${orderRef}${input.reason}${countSuffix}`
  const isCritical = input.severity === ALERT_SEVERITY.CRITICAL

  return {
    templateId: 'owner-ops-alert-v1',
    templateVersion: NOTIFICATION_TEMPLATE_VERSION,
    dltTemplateKey: 'OWNER_ALERT' as DltTemplateKey,
    smsBody: `[${input.severity}] ${input.brandName}: ${safeSummary}`.slice(0, 160),
    smsVariables: {
      var1: input.severity,
      var2: input.orderNumber ?? input.alertKey,
      var3: safeSummary.slice(0, 80),
    },
    emailSubject: `[${input.severity}] ${input.brandName} Alert — ${input.alertKey}${input.orderNumber ? ` (${input.orderNumber})` : ''}`,
    emailText: `${input.severity} alert (${input.alertKey})\n\n${safeSummary}\n\nNo customer PII included.`,
    emailHtml: renderBrandedEmailShell({
      brandName: input.brandName,
      supportEmail: input.supportEmail,
      supportPhone: input.supportPhone,
      heading: `${isCritical ? 'Critical' : 'Warning'} Alert: ${input.alertKey}`,
      preheader: safeSummary,
      bodyHtml: `
        <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:${isCritical ? '#8F2626' : BRAND_COLORS.bronze};letter-spacing:1.4px;text-transform:uppercase;">Severity: ${escapeHtml(input.severity)}</p>
        ${input.orderNumber ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Order Number:</strong> <span style="font-family:monospace;">${escapeHtml(input.orderNumber)}</span></p>` : ''}
        <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${escapeHtml(safeSummary)}</p>
        <p style="margin:0;font-size:12px;color:${BRAND_COLORS.sage};">Alert contains order reference and operational reason only (no customer personal data).</p>`,
    }),
  }
}
