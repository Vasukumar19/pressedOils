export const SIZES = ['500 ml', '1 L', '5 L'] as const
export type Size = (typeof SIZES)[number]

export interface Product {
  id: string
  index: string
  name: string
  native: string
  use: string
  region: string
  image: string
  imageAlt: string
  placeholder: string
  /** Price per size. `null` until real prices are supplied; nothing is invented. */
  prices: Record<Size, number | null>
}

export const PRODUCTS: Product[] = [
  {
    id: 'groundnut',
    index: '01',
    name: 'Groundnut oil',
    native: 'கடலை எண்ணெய்',
    use: 'Everyday frying & savoury cooking',
    region: '[REGION]',
    image: '/images/product-groundnut.png',
    imageAlt: 'Glass bottle of golden oil beside raw groundnuts',
    placeholder: '[GROUNDNUT BOTTLE & SEEDS]',
    prices: { '500 ml': null, '1 L': null, '5 L': null },
  },
  {
    id: 'sesame',
    index: '02',
    name: 'Sesame oil',
    native: 'நல்லெண்ணெய்',
    use: 'Tempering, pickles & finishing',
    region: '[REGION]',
    image: '/images/product-sesame.png',
    imageAlt: 'Glass bottle of amber oil beside sesame seeds',
    placeholder: '[SESAME BOTTLE & SEEDS]',
    prices: { '500 ml': null, '1 L': null, '5 L': null },
  },
  {
    id: 'coconut',
    index: '03',
    name: 'Coconut oil',
    native: 'தேங்காய் எண்ணெய்',
    use: 'Fragrant curries & festival cooking',
    region: '[REGION]',
    image: '/images/product-coconut.png',
    imageAlt: 'Glass bottle of clear oil beside coconut halves',
    placeholder: '[COCONUT BOTTLE & HALVES]',
    prices: { '500 ml': null, '1 L': null, '5 L': null },
  },
]

export function getProduct(id: string) {
  return PRODUCTS.find((p) => p.id === id)
}

export function formatPrice(value: number | null) {
  if (value === null) return '[PRICE]'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}
