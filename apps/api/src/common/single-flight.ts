/**
 * Single-flight deduplication: ensures only one concurrent async producer
 * runs per key during a cache miss or Redis outage (cache-stampede protection).
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined
    if (existing) {
      return existing
    }

    const promise = fn().finally(() => {
      this.inFlight.delete(key)
    })

    this.inFlight.set(key, promise)
    return promise
  }

  size(): number {
    return this.inFlight.size
  }
}

/**
 * Adds bounded random jitter (+/- jitterRatio) to a base TTL in seconds
 * so cached keys never expire simultaneously.
 */
export function withJitter(
  baseSeconds: number,
  jitterRatio = 0.2,
  randomFn: () => number = Math.random,
): number {
  const spread = baseSeconds * jitterRatio
  const offset = (randomFn() * 2 - 1) * spread
  return Math.max(1, Math.round(baseSeconds + offset))
}
