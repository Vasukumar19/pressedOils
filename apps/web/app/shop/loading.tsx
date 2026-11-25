export default function ShopLoading() {
  return (
    <main className="bg-ivory min-h-[100svh] px-5 pt-36 pb-24 md:px-10 md:pt-44">
      <div className="mx-auto max-w-[1400px] animate-pulse space-y-12">
        <div className="space-y-4">
          <div className="bg-champagne h-4 w-32" />
          <div className="bg-champagne h-14 w-64" />
        </div>
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-4">
              <div className="bg-champagne aspect-[4/5] w-full" />
              <div className="bg-champagne h-8 w-2/3" />
              <div className="bg-champagne h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
