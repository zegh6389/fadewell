import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = new URL('../public/', import.meta.url)
const font = await fetch('https://cdn.jsdelivr.net/npm/@fontsource-variable/manrope@latest/files/manrope-latin-wght-normal.woff2')
if (!font.ok) throw new Error(`Manrope font: ${font.status}`)
await writeFile(new URL('fonts/manrope-latin.woff2', root), Buffer.from(await font.arrayBuffer()))
const photos = {
  'telehealth-doctor': 'photo-1559839734-2b71ea197ec2',
  'telehealth-consultation': 'photo-1612349317150-e413f6a5b16d',
  'botanical-bud': 'photo-1603909223429-69bb7101f420',
  'sample-patient': 'photo-1500648767791-00dcc994a43e'
}
const images = {}
for (const [name, id] of Object.entries(photos)) {
  const response = await fetch(`https://images.unsplash.com/${id}?w=1000&q=85&fit=crop`)
  if (!response.ok) throw new Error(`${name}: ${response.status}`)
  const image = await sharp(Buffer.from(await response.arrayBuffer())).webp({ quality: 84 }).toBuffer()
  images[name] = image
  await writeFile(new URL(`assets/${name}.webp`, root), image)
}

const mark = `<rect width="64" height="64" rx="20" fill="#174a32"/><path d="M32 43C16 39 13 25 17 15c12 0 20 9 15 28Z" fill="#d6e255"/><path d="M32 43c-3-16 4-26 17-28 4 13-3 24-17 28Z" fill="#a7cda9"/><path d="M32 47V29" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M48 39v10m-5-5h10" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`
await writeFile(new URL('assets/brand-mark.svg', root), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${mark}</svg>`)
const portrait = await sharp(images['sample-patient']).resize(170, 204, { fit: 'cover', position: 'attention' }).png().toBuffer()
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630" viewBox="0 0 1000 630">
  <defs><clipPath id="card"><rect x="2" y="2" width="996" height="626" rx="32"/></clipPath><clipPath id="portrait"><rect x="56" y="208" width="170" height="204" rx="16"/></clipPath></defs>
  <g clip-path="url(#card)">
  <rect width="1000" height="630" fill="white"/>
  <circle cx="976" cy="50" r="245" fill="#f1f6ef"/><circle cx="976" cy="50" r="190" fill="none" stroke="#dde9dc" stroke-width="2"/>
  <g transform="translate(56 46)">${mark}</g>
  <g font-family="Segoe UI, sans-serif" fill="#174a32">
    <text x="140" y="78" font-size="32" font-weight="700">MmjGreen<tspan fill="#4a8f6c">.</tspan></text>
    <text x="141" y="104" font-size="13" letter-spacing="3">CARE, ON YOUR TERMS</text>
    <rect x="756" y="56" width="188" height="36" rx="18" fill="#eaf2e7"/>
    <text x="850" y="80" text-anchor="middle" font-size="14" font-weight="700" letter-spacing="2">SAMPLE CARD</text>
    <text x="56" y="165" font-size="17" letter-spacing="3" font-weight="600">MEDICAL CANNABIS PATIENT</text>
    <image href="data:image/png;base64,${portrait.toString('base64')}" x="56" y="208" width="170" height="204" clip-path="url(#portrait)"/>
    <text x="141" y="440" text-anchor="middle" font-size="12" fill="#617364" letter-spacing="2">DEMO PORTRAIT</text>
    <text x="264" y="228" font-size="12" fill="#617364" letter-spacing="2">PATIENT NAME</text>
    <text x="264" y="269" font-size="36" font-weight="600">Avery Morgan</text>
    <text x="264" y="310" font-size="12" fill="#617364" letter-spacing="2">PATIENT ID</text>
    <text x="264" y="338" font-size="21" font-weight="600">DEMO · 0248 · 6193</text>
    <text x="640" y="310" font-size="12" fill="#617364" letter-spacing="2">DATE OF BIRTH</text>
    <text x="640" y="338" font-size="21">14 AUG 1992</text>
    <text x="264" y="382" font-size="12" fill="#617364" letter-spacing="2">ISSUED</text>
    <text x="264" y="410" font-size="20">01 SEP 2026</text>
    <text x="500" y="382" font-size="12" fill="#617364" letter-spacing="2">EXPIRES</text>
    <text x="500" y="410" font-size="20">01 SEP 2027</text>
    <text x="736" y="382" font-size="12" fill="#617364" letter-spacing="2">STATE</text>
    <text x="736" y="410" font-size="20">Colorado</text>
    <rect x="56" y="470" width="888" height="56" rx="12" fill="#f1f6ef"/>
    <text x="80" y="504" font-size="14">Illustrative layout only. Requirements and card designs vary by state.</text>
    <rect y="560" width="1000" height="70" fill="#174a32"/>
    <text x="56" y="602" fill="white" font-size="16" font-weight="600" letter-spacing="2">MMJGREEN.COM</text>
    <text x="944" y="602" text-anchor="end" fill="#d6e255" font-size="13" letter-spacing="2">DEMO ONLY · NOT A VALID CREDENTIAL</text>
  </g></g><rect x="2" y="2" width="996" height="626" rx="32" fill="none" stroke="#dce7da" stroke-width="3"/>
</svg>`
await writeFile(new URL('assets/card-premium.svg', root), card)
await sharp(Buffer.from(card)).webp({ quality: 94 }).toFile(new URL('assets/card-premium.webp', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
await writeFile(new URL('assets/photography-sources.txt', root), Object.entries(photos).map(([name, id]) => `${name}: https://unsplash.com/photos/${id.replace('photo-', '')}\nSource: https://images.unsplash.com/${id}\nEditorial stock imagery; not a representation of an actual MmjGreen clinician or patient.\n`).join('\n'))
console.log('Premium brand, sample card, and three optimized editorial photographs written.')
