'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatPaiseToInr } from '@pressedoils/shared'
import { AnimatePresence, motion } from 'motion/react'
import { Menu, ShoppingBag, X } from 'lucide-react'
import { useCart } from '@/lib/cart'
import { cn } from '@/lib/utils'

interface AnnouncementBarProps {
  freeShippingThresholdPaise: number
}

function AnnouncementBar({ freeShippingThresholdPaise }: AnnouncementBarProps) {
  return (
    <div className="bg-gold text-forest px-4 py-2 text-center text-[11px] leading-relaxed font-semibold tracking-[0.16em] uppercase md:text-xs md:tracking-[0.2em]">
      <span>
        {freeShippingThresholdPaise > 0
          ? `Free shipping above ${formatPaiseToInr(freeShippingThresholdPaise)}`
          : 'Small-batch cold-pressed oils'}
      </span>
      <span aria-hidden className="mx-3 hidden sm:inline">
        ·
      </span>
      <span className="block sm:inline">Pressing date on every bottle</span>
    </div>
  )
}

interface NavbarProps {
  brandName?: string
  freeShippingThresholdPaise?: number
}

export function Navbar({
  brandName = '[YOUR BRAND]',
  freeShippingThresholdPaise: thresholdProp,
}: NavbarProps) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const { count, setOpen, freeShippingThresholdPaise: contextThreshold } = useCart()
  const threshold = thresholdProp ?? contextThreshold

  const isHome = pathname === '/'
  const links = [
    { label: 'Why cold pressed', href: isHome ? '#why' : '/#why', isAnchor: isHome },
    { label: 'Process', href: isHome ? '#process' : '/#process', isAnchor: isHome },
    { label: 'Story', href: isHome ? '#story' : '/#story', isAnchor: isHome },
    { label: 'Shop', href: '/shop', isAnchor: false },
  ]

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={cn(
          'overflow-hidden transition-[max-height] duration-500 ease-out',
          scrolled ? 'max-h-0' : 'max-h-20',
        )}
      >
        <AnnouncementBar freeShippingThresholdPaise={threshold} />
      </div>
      <nav
        aria-label="Primary"
        className={cn(
          'border-b transition-colors duration-500',
          scrolled || menuOpen || !isHome
            ? 'border-gold/25 bg-champagne/95 backdrop-blur-md'
            : 'border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 md:h-[72px] md:px-10">
          <Link
            href="/"
            className="text-ink font-serif text-xl font-medium tracking-tight whitespace-nowrap italic sm:text-2xl md:text-[28px]"
          >
            {brandName}
          </Link>

          <ul className="hidden items-center gap-10 lg:flex">
            {links.map((link) => (
              <li key={link.href}>
                {link.isAnchor ? (
                  <a
                    href={link.href}
                    className="link-underline text-ink/85 hover:text-ink pb-1 text-[12px] font-medium tracking-[0.2em] uppercase transition-colors"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    href={link.href}
                    className="link-underline text-ink/85 hover:text-ink pb-1 text-[12px] font-medium tracking-[0.2em] uppercase transition-colors"
                  >
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-ink hover:text-bronze flex min-h-11 items-center gap-2 px-2 text-xs font-medium tracking-[0.2em] whitespace-nowrap uppercase transition-colors sm:px-3 sm:text-xs"
              aria-label={`Open bag, ${count} ${count === 1 ? 'item' : 'items'}`}
            >
              <ShoppingBag className="size-[18px]" aria-hidden />
              <span>
                Bag <span className="tabular-nums">({count})</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="text-ink flex size-11 items-center justify-center lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
            </button>
          </div>
        </div>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'calc(100svh - 64px)' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="bg-champagne overflow-hidden lg:hidden"
          >
            <ul className="flex h-full flex-col justify-center gap-6 px-8 pb-16">
              {links.map((link, i) => (
                <motion.li
                  key={link.href}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.07, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                >
                  {link.isAnchor ? (
                    <a
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="text-ink font-serif text-5xl italic"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="text-ink font-serif text-5xl italic"
                    >
                      {link.label}
                    </Link>
                  )}
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
