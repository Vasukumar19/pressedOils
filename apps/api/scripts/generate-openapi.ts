import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { configureApp, createOpenApiDocument } from '../src/app-setup'
import { validateEnv } from '../src/env'
import { PrismaService } from '../src/prisma/prisma.service'
import { RedisService } from '../src/redis/redis.service'

async function generate() {
  const testEnv = validateEnv({
    NODE_ENV: 'test',
    APP_ENV: 'development',
    CORS_ORIGINS: 'http://localhost:3000',
  })

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ $connect: async () => {}, $disconnect: async () => {}, $queryRaw: async () => [] })
    .overrideProvider(RedisService)
    .useValue({
      onModuleInit: async () => {},
      onModuleDestroy: async () => {},
      getJson: async () => null,
      setJson: async () => {},
      getString: async () => null,
      setString: async () => {},
      incrKey: async () => null,
      del: async () => {},
      incrRateLimit: async () => null,
      ping: async () => 'ok',
    })
    .compile()

  const app = moduleRef.createNestApplication({ bodyParser: false })
  configureApp(app, testEnv)
  await app.init()

  const document = createOpenApiDocument(app)
  const outPath = resolve(__dirname, '..', 'openapi.json')
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await app.close()

  console.log(`✅  OpenAPI spec written to ${outPath}`)
}

generate().catch((err) => {
  console.error('❌  Failed to generate OpenAPI spec:', err)
  process.exit(1)
})
