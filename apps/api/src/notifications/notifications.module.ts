import { Global, Module } from '@nestjs/common'
import { isProductionRuntime } from '@pressedoils/shared'
import { env } from '../env'
import { SettingsModule } from '../settings/settings.module'
import { EMAIL_TRANSPORT, SMS_TRANSPORT } from './notification.types'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'
import { MockEmailTransport, MockSmsTransport } from './transports/mock-transports'
import { Msg91SmsTransport } from './transports/msg91-sms.transport'
import { ResendEmailTransport } from './transports/resend-email.transport'

@Global()
@Module({
  imports: [SettingsModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: EMAIL_TRANSPORT,
      useFactory: () => {
        const isProd = isProductionRuntime({
          APP_ENV: env.APP_ENV,
          IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
        })
        if (isProd || env.EMAIL_PROVIDER === 'resend') {
          return new ResendEmailTransport()
        }
        return new MockEmailTransport()
      },
    },
    {
      provide: SMS_TRANSPORT,
      useFactory: () => {
        const isProd = isProductionRuntime({
          APP_ENV: env.APP_ENV,
          IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
        })
        if (isProd || env.SMS_PROVIDER === 'msg91') {
          return new Msg91SmsTransport()
        }
        return new MockSmsTransport()
      },
    },
    NotificationsService,
  ],
  exports: [EMAIL_TRANSPORT, SMS_TRANSPORT, NotificationsService],
})
export class NotificationsModule {}
