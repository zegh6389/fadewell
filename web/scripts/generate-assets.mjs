/**
 * FadeWell — brand asset generator.
 *
 * Renders every brand image from SVG source so the output is deterministic and
 * reproducible. Two deliberate decisions:
 *
 *  - Clinician imagery is an abstract gradient + monogram, not a synthetic
 *    photograph. Inventing a face for a real medical role would misrepresent
 *    who will actually evaluate a patient.
 *  - Nothing is fetched from the network: `img-src 'self' data:` under the
 *    private CSP, and self-hosted assets keep the public site identical.
 *
 * Run: node scripts/generate-assets.mjs
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'public')
const assets = join(publicDir, 'assets')

const VOID = '#05060E'
const INK = '#0A0D1C'

/* ---------- Shared SVG fragments ------------------------------- */

/** Deterministic pseudo-random so re-runs produce byte-identical assets. */
function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Aurora field.
 *
 * The palette is passed in rather than sampled at random: unconstrained colour
 * picking drifted off-brand (murky olive) and read as a rendering fault rather
 * than a deliberate gradient. Each asset gets an explicit, controlled mix.
 */
function auroraField({ width, height, seed, blobs, palette }) {
  const rand = seeded(seed)
  const defs = blobs
    .map((blob, i) => {
      const cx = Math.round(rand() * width)
      const cy = Math.round(rand() * height)
      const r = Math.round(blob * (0.6 + rand() * 0.8))
      const color = palette[i % palette.length]
      return `<radialGradient id="a${i}" cx="50%" cy="50%">
        <stop offset="0%" stop-color="${color}" stop-opacity="${(0.72 + rand() * 0.24).toFixed(2)}"/>
        <stop offset="55%" stop-color="${color}" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </radialGradient>`
    })
    .join('')

  const shapes = blobs
    .map((blob, i) => {
      const cx = Math.round(rand() * width)
      const cy = Math.round(rand() * height)
      const r = Math.round(blob * (0.6 + rand() * 0.8))
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#a${i})"/>`
    })
    .join('')

  // A light blur keeps the aurora reading as light rather than as flat blocks,
  // without hazing the whole composition into a single muddy tone.
  return `<defs>${defs}
    <filter id="soft" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="${Math.round(width * 0.035)}"/>
    </filter>
    <linearGradient id="wash" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#4B46FF" stop-opacity="0.20"/>
      <stop offset="50%" stop-color="#7C5CFF" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#34E0E8" stop-opacity="0.16"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${VOID}"/>
  <rect width="${width}" height="${height}" fill="url(#wash)"/>
  <g filter="url(#soft)">${shapes}</g>`
}

/** On-brand aurora mixes, one per asset so no two read identically. */
const PALETTES = {
  amara: ['#7C5CFF', '#4B46FF', '#34E0E8'],
  rafael: ['#4B46FF', '#34E0E8', '#6EE7B7'],
  priya: ['#FF6B9D', '#7C5CFF', '#FFC46B'],
  marcus: ['#34E0E8', '#6EE7B7', '#4B46FF'],
  brand: ['#7C5CFF', '#4B46FF', '#34E0E8', '#FF6B9D'],
  studio: ['#4B46FF', '#7C5CFF', '#34E0E8']
}

/** The FadeWell horizon mark, drawn at an arbitrary scale. */
function mark(cx, cy, size, opacity = 1) {
  const s = size / 32
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})" opacity="${opacity}">
    <defs>
      <linearGradient id="mg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop stop-color="#7C5CFF"/><stop offset="0.55" stop-color="#4B46FF"/><stop offset="1" stop-color="#34E0E8"/>
      </linearGradient>
    </defs>
    <path d="M7 20.5h18" stroke="url(#mg)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M7 20.5h11" stroke="url(#mg)" stroke-width="2.2" stroke-linecap="round" opacity="0.55"/>
    <path d="M7 16.5c3.6 0 5-4.6 9-4.6s5.4 4.6 9 4.6" stroke="url(#mg)" stroke-width="2.2" stroke-linecap="round" opacity="0.9"/>
    <circle cx="24.5" cy="11.4" r="2.1" fill="#34E0E8"/>
  </g>`
}

const NOISE = `<filter id="n" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/>
  </filter>`

function grain(width, height, opacity = 0.05) {
  return `<rect width="${width}" height="${height}" filter="url(#n)" opacity="${opacity}"/>`
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${NOISE}${body}</svg>`
}

/* ---------- Assets --------------------------------------------- */

/** Abstract gradient portrait carrying the clinician's initials. */
function clinicianSvg(initials, seed, palette) {
  const w = 720
  const h = 900
  return svg(
    w,
    h,
    `
    ${auroraField({ width: w, height: h, seed, blobs: [300, 260, 320], palette })}
    <g opacity="0.5">
      <circle cx="${w / 2}" cy="${h * 0.42}" r="150" fill="none" stroke="#ffffff" stroke-opacity="0.10"/>
      <circle cx="${w / 2}" cy="${h * 0.42}" r="196" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-dasharray="5 9"/>
    </g>
    <circle cx="${w / 2}" cy="${h * 0.42}" r="118" fill="${INK}" fill-opacity="0.55"
            stroke="#ffffff" stroke-opacity="0.16"/>
    <text x="${w / 2}" y="${h * 0.42 + 34}" text-anchor="middle"
          font-family="Sora, Segoe UI, Helvetica, Arial, sans-serif" font-size="86" font-weight="600"
          letter-spacing="-4" fill="#F4F5FB">${initials}</text>
    <text x="${w / 2}" y="${h * 0.42 + 78}" text-anchor="middle"
          font-family="JetBrains Mono, Consolas, monospace" font-size="19" letter-spacing="4"
          fill="#34E0E8" fill-opacity="0.85">FADEWELL CLINICIAN</text>
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="${w}" y2="0">
        <stop stop-color="#7C5CFF"/><stop offset="0.55" stop-color="#4B46FF"/><stop offset="1" stop-color="#34E0E8"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${h - 8}" width="${w}" height="8" fill="url(#fade)"/>
    ${grain(w, h, 0.045)}`
  )
}

/** Brand cover used for the About split and social sharing. */
function coverSvg({ width, height, title, subtitle, seed, palette }) {
  return svg(
    width,
    height,
    `
    ${auroraField({ width, height, seed, blobs: [340, 280, 320, 240], palette })}
    <rect width="${width}" height="${height}" fill="${VOID}" fill-opacity="0.14"/>
    ${mark(width * 0.14, height * 0.2, 84)}
    <text x="${width * 0.08}" y="${height * 0.47}"
          font-family="Sora, Segoe UI, Helvetica, Arial, sans-serif" font-size="${Math.round(width * 0.072)}"
          font-weight="600" letter-spacing="-4" fill="#F4F5FB">${title}</text>
    <text x="${width * 0.08}" y="${height * 0.57}"
          font-family="Instrument Serif, Georgia, serif" font-style="italic"
          font-size="${Math.round(width * 0.048)}" fill="#A9B0CD">${subtitle}</text>
    <g>
      <rect x="${width * 0.08}" y="${height * 0.66}" width="${Math.round(width * 0.16)}" height="6" rx="3" fill="#7C5CFF"/>
      <rect x="${width * 0.08 + Math.round(width * 0.17)}" y="${height * 0.66}" width="${Math.round(width * 0.1)}" height="6" rx="3" fill="#34E0E8" fill-opacity="0.7"/>
    </g>
    <text x="${width * 0.08}" y="${height * 0.82}"
          font-family="JetBrains Mono, Consolas, monospace" font-size="${Math.round(width * 0.017)}"
          letter-spacing="7" fill="#6D7594">FADEWELL.COM</text>
    ${grain(width, height, 0.05)}`
  )
}

function iconSvg(size, rounded) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
        <stop stop-color="#7C5CFF"/><stop offset="0.55" stop-color="#4B46FF"/><stop offset="1" stop-color="#34E0E8"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${rounded}" fill="#0A0D1C"/>
    ${mark(size / 2, size / 2, size * 0.74)}
  </svg>`
}

/* ---------- Write ---------------------------------------------- */

async function writeWebp(name, markup) {
  const target = join(assets, name)
  await sharp(Buffer.from(markup)).webp({ quality: 86 }).toFile(target)
  console.log(`  ${name}`)
}

async function writePng(name, markup) {
  const target = join(publicDir, name)
  await sharp(Buffer.from(markup)).png().toFile(target)
  console.log(`  ${name}`)
}

async function main() {
  await mkdir(assets, { recursive: true })

  console.log('Generating FadeWell brand assets…')

  const clinicians = [
    ['clinician-amara.webp', 'AO', 20260111, PALETTES.amara],
    ['clinician-rafael.webp', 'RD', 20260222, PALETTES.rafael],
    ['clinician-priya.webp', 'PR', 20260333, PALETTES.priya],
    ['clinician-marcus.webp', 'MW', 20260444, PALETTES.marcus]
  ]
  for (const [file, initials, seed, palette] of clinicians) {
    await writeWebp(file, clinicianSvg(initials, seed, palette))
  }

  await writeWebp(
    'about-studio.webp',
    coverSvg({
      width: 1200,
      height: 900,
      title: 'Care, minus the paperwork.',
      subtitle: 'Denver · since 2022',
      seed: 777001,
      palette: PALETTES.studio
    })
  )

  await writeWebp(
    'hero-field.webp',
    coverSvg({
      width: 1600,
      height: 900,
      title: 'FadeWell',
      subtitle: 'Medical card evaluation, made calm.',
      seed: 424242,
      palette: PALETTES.brand
    })
  )

  // Open Graph — PNG and JPEG for maximum crawler compatibility.
  const ogMarkup = coverSvg({
    width: 1200,
    height: 630,
    title: 'FadeWell',
    subtitle: 'Medical card evaluation, made calm.',
    seed: 424242,
    palette: PALETTES.brand
  })
  const ogPath = join(assets, 'og-cover.png')
  await sharp(Buffer.from(ogMarkup)).png().toFile(ogPath)
  console.log('  assets/og-cover.png')
  await sharp(Buffer.from(ogMarkup)).jpeg({ quality: 90 }).toFile(join(assets, 'og-cover.jpg'))
  console.log('  assets/og-cover.jpg')

  await writePng('apple-touch-icon.png', iconSvg(180, 40))
  await writePng('icon-192.png', iconSvg(192, 44))
  await writePng('icon-512.png', iconSvg(512, 112))

  console.log('Done.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
