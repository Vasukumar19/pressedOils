'use client'

import { useState } from 'react'
import Image from 'next/image'
import { isPlaceholderUrl, type ProductImageDto } from '@pressedoils/shared'
import { cn } from '@/lib/utils'
import { MediaFrame } from './primitives'

interface ProductGalleryProps {
  productName: string
  images: ProductImageDto[]
}

export function ProductGallery({ productName, images }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const fallbackImage: ProductImageDto = {
    id: 'fallback',
    url: '/images/hero-light.png',
    alt: `${productName} cold-pressed oil`,
    sortOrder: 0,
  }
  const active = images[activeIndex] ?? images[0] ?? fallbackImage
  const showPlaceholderTag = isPlaceholderUrl(active.url)

  return (
    <div>
      <MediaFrame
        src={active.url}
        alt={active.alt}
        caption={showPlaceholderTag ? '[SAMPLE PRODUCT PHOTO]' : undefined}
        tag={showPlaceholderTag ? 'MEDIA PLACEHOLDER' : undefined}
        priority
        className="aspect-[4/5] w-full"
        sizes="(min-width: 1024px) 45vw, 100vw"
      />

      {images.length > 1 ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {images.map((image, idx) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActiveIndex(idx)}
              aria-label={`View image ${idx + 1} for ${productName}`}
              aria-current={idx === activeIndex ? 'true' : undefined}
              className={cn(
                'relative size-16 overflow-hidden border transition-opacity',
                idx === activeIndex
                  ? 'border-forest opacity-100'
                  : 'border-gold/30 opacity-65 hover:opacity-100',
              )}
            >
              <Image src={image.url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
