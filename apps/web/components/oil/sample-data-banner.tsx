interface SampleDataBannerProps {
  show: boolean
  label?: string
}

export function SampleDataBanner({
  show,
  label = 'Sample catalog data for development/staging preview — sample prices, stock, and /placeholders/ imagery are not live production inventory.',
}: SampleDataBannerProps) {
  if (!show) return null

  return (
    <div
      role="status"
      className="bg-champagne border-gold/40 text-ink border-b px-4 py-2 text-center text-xs"
    >
      <span className="text-bronze mr-2 inline-block text-[10px] font-medium tracking-[0.18em] uppercase">
        Preview Mode
      </span>
      <span className="text-ink/85">{label}</span>
    </div>
  )
}
