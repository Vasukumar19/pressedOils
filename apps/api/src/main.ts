import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { env } from './env'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  await app.listen(env.PORT)
  console.log(`API running on http://localhost:${env.PORT}/api`)
}

bootstrap()
