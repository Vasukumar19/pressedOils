import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  isProductionRuntime,
  OTP_CONSTANTS,
  OTP_PURPOSE,
  type OtpPurpose,
  type OtpSendRequestDto,
  type OtpSendResponseDto,
  otpSendResponseSchema,
  type OtpVerifyRequestDto,
  type OtpVerifyResponseDto,
  otpVerifyResponseSchema,
} from '@pressedoils/shared'
import { env } from '../env'
import { hashPhoneForOtp, maskPhone } from '../notifications/notification.types'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { ResilientThrottlerStorage } from '../redis/resilient-throttler.storage'
import { SettingsService } from '../settings/settings.service'
import { TurnstileService } from './turnstile.service'

const DEV_OTP_HMAC_FALLBACK = 'dev-only-otp-hmac-secret-never-use-in-prod-1234'

function purposeLabelForSms(purpose: OtpPurpose): string {
  switch (purpose) {
    case OTP_PURPOSE.COD_CHECKOUT:
      return 'COD verification'
    case OTP_PURPOSE.ORDER_TRACKING:
      return 'order tracking'
    case OTP_PURPOSE.PICKUP_CODE_REISSUE:
      return 'pickup code'
  }
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: ResilientThrottlerStorage,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly turnstileService: TurnstileService,
  ) {}

  private getOtpSecret(): string {
    const isProd = isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
    if (isProd) {
      if (!env.OTP_HMAC_SECRET) {
        throw new ServiceUnavailableException('OTP verification is temporarily unavailable')
      }
      return env.OTP_HMAC_SECRET
    }
    return env.OTP_HMAC_SECRET ?? env.PICKUP_CODE_HMAC_SECRET ?? DEV_OTP_HMAC_FALLBACK
  }

  private hashChallengeCode(challengeId: string, code: string): string {
    return createHmac('sha256', this.getOtpSecret())
      .update(`otp:${challengeId}:${code.trim()}`)
      .digest('hex')
  }

  private hashVerificationToken(token: string): string {
    return createHmac('sha256', this.getOtpSecret())
      .update(`verify-token:${token.trim()}`)
      .digest('hex')
  }

  private constantTimeHexEquals(expectedHex: string, actualHex: string): boolean {
    if (expectedHex.length !== actualHex.length) return false
    return timingSafeEqual(Buffer.from(expectedHex, 'utf8'), Buffer.from(actualHex, 'utf8'))
  }

  async sendOtp(
    dto: OtpSendRequestDto,
    context: { ip: string; sessionId: string },
  ): Promise<OtpSendResponseDto> {
    if (!this.settingsService.isSmsOtpReady()) {
      throw new ServiceUnavailableException('SMS verification is currently disabled')
    }

    const secret = this.getOtpSecret()
    const phoneHash = hashPhoneForOtp(dto.phone, secret)

    // 1. Cooldown check per (purpose, phone, session) before burning quota
    const cooldownKey = `otp:cooldown:${dto.purpose}:${phoneHash}:${context.sessionId}`
    const cooling = await this.redis.getString(cooldownKey)
    if (cooling) {
      throw new HttpException(
        `Please wait ${OTP_CONSTANTS.RESEND_COOLDOWN_SECONDS} seconds before requesting another OTP.`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    // 2. Anti-SMS pumping CAPTCHA trigger after repeated sends or any prior OTP failures
    const sendsWindowKey = `otp:sends:${phoneHash}`
    const captchaFlagKey = `otp:captcha:${phoneHash}`
    const [priorSendsRaw, priorFailFlag] = await Promise.all([
      this.redis.getString(sendsWindowKey),
      this.redis.getString(captchaFlagKey),
    ])
    const priorSends = priorSendsRaw ? Number(priorSendsRaw) || 0 : 0
    const captchaRequired =
      Boolean(priorFailFlag) || priorSends >= OTP_CONSTANTS.CAPTCHA_TRIGGER_SENDS

    if (captchaRequired) {
      const captchaOk = await this.turnstileService.verifyToken(dto.turnstileToken, context.ip)
      if (!captchaOk) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'CAPTCHA_REQUIRED',
          captchaRequired: true,
          message: 'Please complete the security check before requesting another OTP.',
        })
      }
    }

    // 3. Enforce per-phone (3/hr), per-session (5/hr), and per-IP (10/hr) rate limits
    const [phoneRate, sessionRate, ipRate] = await Promise.all([
      this.storage.increment(
        `otp:phone:${phoneHash}`,
        3_600_000,
        OTP_CONSTANTS.PHONE_PER_HOUR,
        3_600_000,
        'otp-phone-1h',
      ),
      this.storage.increment(
        `otp:sess:${context.sessionId}`,
        3_600_000,
        OTP_CONSTANTS.SESSION_PER_HOUR,
        3_600_000,
        'otp-sess-1h',
      ),
      this.storage.increment(
        `otp:ip:${context.ip}`,
        3_600_000,
        OTP_CONSTANTS.IP_PER_HOUR,
        3_600_000,
        'otp-ip-1h',
      ),
    ])

    if (
      phoneRate.totalHits > OTP_CONSTANTS.PHONE_PER_HOUR ||
      sessionRate.totalHits > OTP_CONSTANTS.SESSION_PER_HOUR ||
      ipRate.totalHits > OTP_CONSTANTS.IP_PER_HOUR ||
      phoneRate.isBlocked ||
      sessionRate.isBlocked ||
      ipRate.isBlocked
    ) {
      throw new HttpException(
        'Too many OTP requests. Please wait an hour before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + OTP_CONSTANTS.TTL_MINUTES * 60_000)
    const resendAvailableAt = new Date(now.getTime() + OTP_CONSTANTS.RESEND_COOLDOWN_SECONDS * 1000)

    const challengeId = cryptoRandomUuid()
    const code = String(randomInt(100000, 1000000))
    const codeHmac = this.hashChallengeCode(challengeId, code)

    await this.prisma.$transaction(async (tx) => {
      await tx.otpChallenge.updateMany({
        where: {
          phone_hash: phoneHash,
          purpose: dto.purpose,
          session_id: context.sessionId,
          consumed_at: null,
        },
        data: { consumed_at: now },
      })

      await tx.otpChallenge.create({
        data: {
          id: challengeId,
          purpose: dto.purpose,
          phone_hash: phoneHash,
          session_id: context.sessionId,
          code_hmac: codeHmac,
          attempts: 0,
          max_attempts: OTP_CONSTANTS.MAX_ATTEMPTS,
          expires_at: expiresAt,
        },
      })
    })

    await Promise.all([
      this.redis.setStringNx(cooldownKey, '1', OTP_CONSTANTS.RESEND_COOLDOWN_SECONDS),
      this.redis.incrKey(sendsWindowKey, 3600),
    ])

    await this.notificationsService.sendOtpSms({
      challengeId,
      phone: dto.phone,
      code,
      ttlMinutes: OTP_CONSTANTS.TTL_MINUTES,
      purposeLabel: purposeLabelForSms(dto.purpose),
    })

    return otpSendResponseSchema.parse({
      challengeId,
      maskedPhone: maskPhone(dto.phone),
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: resendAvailableAt.toISOString(),
      captchaRequired: priorSends + 1 >= OTP_CONSTANTS.CAPTCHA_TRIGGER_SENDS,
    })
  }

  async verifyOtp(
    dto: OtpVerifyRequestDto,
    context: { ip: string; sessionId: string },
  ): Promise<OtpVerifyResponseDto> {
    const secret = this.getOtpSecret()
    const phoneHash = hashPhoneForOtp(dto.phone, secret)

    const verifyRate = await this.storage.increment(
      `otp:verify:ip:${context.ip}`,
      60_000,
      20,
      60_000,
      'otp-verify-ip',
    )
    if (verifyRate.totalHits > 20 || verifyRate.isBlocked) {
      throw new HttpException('Too many verification attempts', HttpStatus.TOO_MANY_REQUESTS)
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string
          purpose: string
          phone_hash: string
          session_id: string
          code_hmac: string
          attempts: number
          max_attempts: number
          expires_at: Date
          consumed_at: Date | null
        }>
      >`SELECT id, purpose, phone_hash, session_id, code_hmac, attempts, max_attempts, expires_at, consumed_at FROM otp_challenges WHERE id = ${dto.challengeId} FOR UPDATE`

      const challenge = rows[0]
      const now = new Date()

      if (
        !challenge ||
        challenge.purpose !== dto.purpose ||
        challenge.phone_hash !== phoneHash ||
        challenge.session_id !== context.sessionId ||
        challenge.consumed_at !== null ||
        challenge.expires_at <= now
      ) {
        return { kind: 'INVALID_OR_EXPIRED' as const }
      }

      if (challenge.attempts >= challenge.max_attempts) {
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: { consumed_at: now },
        })
        return { kind: 'MAX_ATTEMPTS' as const }
      }

      const candidateHmac = this.hashChallengeCode(challenge.id, dto.code)
      if (!this.constantTimeHexEquals(challenge.code_hmac, candidateHmac)) {
        const nextAttempts = challenge.attempts + 1
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: {
            attempts: nextAttempts,
            ...(nextAttempts >= challenge.max_attempts ? { consumed_at: now } : {}),
          },
        })
        return {
          kind:
            nextAttempts >= challenge.max_attempts
              ? ('MAX_ATTEMPTS' as const)
              : ('WRONG_CODE' as const),
          attemptsRemaining: Math.max(0, challenge.max_attempts - nextAttempts),
        }
      }

      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumed_at: now },
      })

      const plaintextToken = randomBytes(24).toString('base64url')
      const tokenHash = this.hashVerificationToken(plaintextToken)
      const tokenExpiresAt = new Date(
        now.getTime() + OTP_CONSTANTS.VERIFICATION_TOKEN_TTL_MINUTES * 60_000,
      )

      await tx.phoneVerificationToken.create({
        data: {
          purpose: dto.purpose,
          token_hash: tokenHash,
          phone_hash: phoneHash,
          session_id: context.sessionId,
          expires_at: tokenExpiresAt,
        },
      })

      return {
        kind: 'VERIFIED' as const,
        verificationToken: plaintextToken,
        expiresAt: tokenExpiresAt.toISOString(),
      }
    })

    if (result.kind !== 'VERIFIED') {
      await this.redis.setStringNx(`otp:captcha:${phoneHash}`, '1', 3600)
      if (result.kind === 'MAX_ATTEMPTS') {
        throw new BadRequestException(
          'Too many incorrect OTP attempts. Please request a fresh OTP.',
        )
      }
      if (result.kind === 'WRONG_CODE') {
        throw new BadRequestException(
          `Incorrect verification code. ${result.attemptsRemaining} attempt(s) remaining.`,
        )
      }
      throw new BadRequestException('OTP has expired or is invalid. Please request a new code.')
    }

    return otpVerifyResponseSchema.parse({
      verified: true,
      verificationToken: result.verificationToken,
      expiresAt: result.expiresAt,
    })
  }

  /**
   * Atomically consumes a short-lived, single-use phone verification token inside a DB transaction.
   * Ensures token matches exact phone number, session, purpose, is unexpired, and has never been used.
   */
  async consumeVerificationTokenInTx(
    tx: Prisma.TransactionClient,
    input: {
      token: string | undefined
      phone: string
      purpose: OtpPurpose
      sessionId: string
    },
  ): Promise<void> {
    const cleanToken = input.token?.trim()
    if (!cleanToken) {
      throw new ForbiddenException(
        'Phone OTP verification is required before completing this action',
      )
    }

    const secret = this.getOtpSecret()
    const tokenHash = this.hashVerificationToken(cleanToken)
    const phoneHash = hashPhoneForOtp(input.phone, secret)

    const updatedRows = await tx.$executeRaw`
      UPDATE phone_verification_tokens
      SET used_at = NOW()
      WHERE token_hash = ${tokenHash}
        AND purpose = ${input.purpose}
        AND phone_hash = ${phoneHash}
        AND session_id = ${input.sessionId}
        AND used_at IS NULL
        AND expires_at > NOW()
    `

    if (updatedRows !== 1) {
      throw new ForbiddenException(
        'Phone verification token is invalid, expired, belongs to a different phone/session, or was already used',
      )
    }
  }
}

function cryptoRandomUuid(): string {
  return randomBytes(16)
    .toString('hex')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, (_, a, b, c, d, e) => {
      const ver = `4${c.slice(1)}`
      const variantNibble = ((parseInt(d[0]!, 16) & 0x3) | 0x8).toString(16)
      return `${a}-${b}-${ver}-${variantNibble}${d.slice(1)}-${e}`
    })
}
