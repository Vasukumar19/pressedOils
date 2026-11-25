import { timingSafeEqual } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { slugSchema } from '@pressedoils/shared'
import { z } from 'zod'
import { WEB_CACHE_TAGS } from '@/lib/api'
import { getRevalidateSecret } from '@/lib/env'

const revalidateBodySchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(120)).min(1).max(20).optional(),
    slugs: z.array(slugSchema).max(20).optional(),
  })
  .strict()

function verifySecret(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const expectedSecret = getRevalidateSecret()
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Revalidation secret is not configured' }, { status: 503 })
  }

  const headerSecret =
    request.headers.get('x-revalidate-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null

  if (!verifySecret(headerSecret, expectedSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    rawBody = {}
  }

  const parsed = revalidateBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid revalidation payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const tagSet = new Set<string>(parsed.data.tags ?? [WEB_CACHE_TAGS.PRODUCTS])
  for (const slug of parsed.data.slugs ?? []) {
    tagSet.add(WEB_CACHE_TAGS.product(slug))
  }

  const tags = Array.from(tagSet)
  for (const tag of tags) {
    revalidateTag(tag, 'max')
  }

  return NextResponse.json({ revalidated: true, tags })
}
