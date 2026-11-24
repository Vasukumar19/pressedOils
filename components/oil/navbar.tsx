'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Menu, ShoppingBag, X } from 'lucide-react'
import { NAV_LINKS } from '@/lib/content'
import { useCart } from '@/lib/cart'
import { cn } from '@/lib/utils'

function AnnouncementBar() {
  return (
    <div className="bg-gold px-4 py-2 text-center text-[11px] font-semibold uppercase leading-relaxed tracking-[0.16em] text-forest md:text-xs md:tracking-[0.2em]">
      <span>
        Free shipping above <span className="bg-forest/10 px-1">[AMOUNT]</span>
      </span>
      <span aria-hidden className="mx-3 hidden sm:inline">
        ·
      </span>
      <span className="block sm:inline">Pressing date on every bottle</span>
    </div>
  )
}

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { count, setOpen } = useCart()

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
        <AnnouncementBar />
      </div>
      <nav
        aria-label="Primary"
        className={cn(
          'border-b transition-colors duration-500',
          scrolled || menuOpen
            ? 'border-gold/25 bg-champagne/95 backdrop-blur-md'
            : 'border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 md:h-[72px] md:px-10">
          <a
            href="#top"
            className="whitespace-nowrap font-serif font-medium text-xl italic tracking-tight text-ink sm:text-2xl md:text-[28px]"
          >
            [YOUR BRAND]
          </a>

          <ul className="hidden items-center gap-10 lg:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="link-underline pb-1 text-[12px] font-medium uppercase tracking-[0.2em] text-ink/85 transition-colors hover:text-ink"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex min-h-11 items-center gap-2 whitespace-nowrap px-2 text-xs sm:px-3 sm:text-xs font-medium uppercase tracking-[0.2em] text-ink transition-colors hover:text-bronze"
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
              className="flex size-11 items-center justify-center text-ink lg:hidden"
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
            className="overflow-hidden bg-champagne lg:hidden"
          >
            <ul className="flex h-full flex-col justify-center gap-6 px-8 pb-16">
              {NAV_LINKS.map((link, i) => (
                <motion.li
                  key={link.href}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.07, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                >
                  <a
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="font-serif text-5xl italic text-ink"
                  >
                    {link.label}
                  </a>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
