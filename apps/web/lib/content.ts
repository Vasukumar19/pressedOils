export const NAV_LINKS = [
  { label: 'Why cold pressed', href: '#why' },
  { label: 'Process', href: '#process' },
  { label: 'Story', href: '#story' },
  { label: 'Shop', href: '#shop' },
]

export const TICKER = [
  'NO ADDED HEAT',
  'NO EXTRACTION SOLVENTS',
  'SMALL BATCHES',
  'PRESSING DATE ON EVERY BOTTLE',
]

export const COMPARE_COLUMNS = ['Refined oil', 'Palm oil', 'Cold pressed']

export const COMPARE_ROWS: { label: string; cells: [string, string, string] }[] = [
  {
    label: 'Extraction',
    cells: ['Mechanical / solvent*', 'From palm fruit', 'Mechanical press'],
  },
  {
    label: 'Heat',
    cells: ['Usually high heat', 'Varies by process', 'No added heat'],
  },
  {
    label: 'After pressing',
    cells: ['Refined, bleached, deodorised*', 'Usually refined', 'Settled & filtered'],
  },
  {
    label: 'Colour & aroma',
    cells: ['Usually neutral', 'Usually neutral*', 'Seed’s own character'],
  },
  {
    label: 'Price',
    cells: ['Typically lower', 'Typically lower', 'Higher seed & batch costs'],
  },
]

export const COMPARE_NOTE =
  '*Methods vary by manufacturer. Refined describes processing; palm describes the source. Cold pressing uses more seed per litre and takes more time. You pay for the seed, the slower process and a smaller yield, not a health promise.'

export interface ProcessStep {
  n: string
  title: string
  body: string
  leaveOut: string
  caption: string
  image: string | null
  alt: string
}

export const PROCESS_STEPS: ProcessStep[] = [
  {
    n: '01',
    title: 'Choose the seed',
    body: 'Start with sound, mature seeds, selected for their aroma and quality.',
    leaveOut: 'Poor-quality seed.',
    caption: '[MACRO / GROUNDNUT, SESAME & COCONUT]',
    image: '/images/seeds-macro.png',
    alt: 'Macro of groundnuts, sesame seeds and coconut halves',
  },
  {
    n: '02',
    title: 'Clean and sort',
    body: 'Remove dust and damaged seeds before they reach the press.',
    leaveOut: 'Shortcuts in sorting.',
    caption: '[FILM / HANDS SORTING SEEDS]',
    image: '/images/sorting-hands.png',
    alt: 'Hands sorting seeds on a woven tray',
  },
  {
    n: '03',
    title: 'Press slowly',
    body: 'Mechanical pressure releases the oil. No external heat is added; friction can create warmth.',
    leaveOut: 'Extraction solvents.',
    caption: '[FILM / WOODEN PRESS IN ACTION]',
    image: null,
    alt: 'Placeholder for the wooden press in action',
  },
  {
    n: '04',
    title: 'Let it settle',
    body: 'Give the oil time to settle naturally, without rushing the batch.',
    leaveOut: 'Chemical clarification.',
    caption: '[PHOTO / OIL IN STEEL VESSELS]',
    image: '/images/steel-vessels.png',
    alt: 'Golden oil resting in steel vessels',
  },
  {
    n: '05',
    title: 'Filter once',
    body: 'A simple filtration removes seed particles while keeping the oil’s character.',
    leaveOut: 'Bleaching and deodorising.',
    caption: '[PHOTO / FILTERING GOLDEN OIL]',
    image: '/images/filtering.png',
    alt: 'Golden oil filtering through muslin cloth',
  },
  {
    n: '06',
    title: 'Lab test and label',
    body: 'Add the batch number and pressing date. Publish the actual report when available.',
    leaveOut: 'Untraceable bottles.',
    caption: '[PHOTO / BATCH LABELLING]',
    image: null,
    alt: 'Placeholder for batch labelling',
  },
]

export const TRUST_CARDS = [
  {
    n: '01',
    title: 'A report for every batch',
    body: '[LAB REPORT PDF] · Documents pending upload. See the test date, batch number and actual results.',
  },
  {
    n: '02',
    title: 'A real licence. A real address.',
    body: 'FSSAI [NO.] · [REGISTERED ADDRESS] · Verification details to be supplied.',
  },
  {
    n: '03',
    title: 'Come and see the press.',
    body: '[PRESS / FARM VISIT DETAILS] · Availability and booking contact to be confirmed.',
  },
  {
    n: '04',
    title: 'From kitchens like yours.',
    body: '[VERIFIED CUSTOMER REVIEWS] · No reviews added yet.',
  },
]

export const KITCHEN_CARDS = [
  {
    n: '01',
    caption: '[PHOTO / TEMPERING]',
    title: 'Tempering',
    body: 'Sesame for a warm, distinctive finish.',
    image: '/images/tempering.png',
    alt: 'Spices and curry leaves sizzling in a tempering pan',
  },
  {
    n: '02',
    caption: '[PHOTO / EVERYDAY FRYING]',
    title: 'Everyday frying',
    body: 'Groundnut for familiar savoury cooking.',
    image: '/images/frying.png',
    alt: 'Savoury fritters frying in a kadai',
  },
  {
    n: '03',
    caption: '[PHOTO / PICKLES]',
    title: 'Pickles',
    body: 'Sesame for recipes that call for its bold aroma.',
    image: '/images/pickles.png',
    alt: 'A jar of mango pickle glistening with oil',
  },
  {
    n: '04',
    caption: '[PHOTO / FESTIVAL COOKING]',
    title: 'Festival cooking',
    body: 'Coconut for dishes that welcome its sweet, nutty character.',
    image: '/images/festival.png',
    alt: 'Coconut, a brass lamp and sweets on a banana leaf',
  },
]

export const KITCHEN_NOTE =
  'A little care goes a long way: do not heat unrefined oils until smoking, or reuse them repeatedly. Choose the oil and temperature that suit your recipe.'

export const LABEL_TERMS = [
  {
    term: 'Cold pressed',
    body: 'Mechanically extracted without added heat. Ask about the actual pressing process.',
  },
  {
    term: 'Wood pressed',
    body: 'Describes the press material. It does not, on its own, guarantee temperature or quality.',
  },
  {
    term: 'Refined',
    body: 'Processed to change colour, flavour or stability. Methods differ between producers.',
  },
]

export const LABEL_CHECKLIST = [
  'ingredients',
  'pressing or packing date',
  'batch number',
  'best-before date',
  'storage instructions',
  'the FSSAI licence',
]

export const FAQ_ITEMS = [
  { q: '[FAQ QUESTION 01]', a: '[ANSWER TO BE SUPPLIED BEFORE LAUNCH]' },
  { q: '[FAQ QUESTION 02]', a: '[ANSWER TO BE SUPPLIED BEFORE LAUNCH]' },
  { q: '[FAQ QUESTION 03]', a: '[ANSWER TO BE SUPPLIED BEFORE LAUNCH]' },
  { q: '[FAQ QUESTION 04]', a: '[ANSWER TO BE SUPPLIED BEFORE LAUNCH]' },
]

export const CONTACT = {
  whatsapp: '[PHONE]',
  email: '[EMAIL ADDRESS]',
}

export function isReal(value: string) {
  return !value.includes('[')
}
