import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

describe('production placeholder asset protection (proxy)', () => {
  it('blocks /placeholders/* with 404 when APP_ENV=production', () => {
    const prevAppEnv = process.env.APP_ENV
    process.env.APP_ENV = 'production'
    try {
      const req = new NextRequest('https://shop.example.com/placeholders/groundnut.svg')
      const res = proxy(req)
      expect(res.status).toBe(404)
    } finally {
      process.env.APP_ENV = prevAppEnv
    }
  })

  it('blocks /placeholders/* with 404 when VERCEL_ENV=production', () => {
    const prevVercel = process.env.VERCEL_ENV
    process.env.VERCEL_ENV = 'production'
    try {
      const req = new NextRequest('https://shop.example.com/placeholders/sesame.svg')
      const res = proxy(req)
      expect(res.status).toBe(404)
    } finally {
      process.env.VERCEL_ENV = prevVercel
    }
  })

  it('allows /placeholders/* in development and staging', () => {
    const prevAppEnv = process.env.APP_ENV
    const prevVercel = process.env.VERCEL_ENV
    process.env.APP_ENV = 'staging'
    delete process.env.VERCEL_ENV
    try {
      const req = new NextRequest('https://staging.example.com/placeholders/groundnut.svg')
      const res = proxy(req)
      expect(res.status).toBe(200)
    } finally {
      process.env.APP_ENV = prevAppEnv
      if (prevVercel !== undefined) process.env.VERCEL_ENV = prevVercel
    }
  })
})
