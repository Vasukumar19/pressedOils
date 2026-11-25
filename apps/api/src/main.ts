import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { configureApp } from './app-setup'
import { env } from './env'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false })
  app.useLogger(app.get(Logger))
  app.enableShutdownHooks()

  configureApp(app, env)

  const server = app.getHttpServer() as {
    requestTimeout: number
    headersTimeout: number
    keepAliveTimeout: number
  }
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  server.keepAliveTimeout = 65_000

  await app.listen(env.PORT)
}

bootstrap()
