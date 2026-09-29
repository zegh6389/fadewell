/**
 * FadeWell — brand asset generator.
 *
 * Renders every brand image from SVG source so the output is deterministic and
 * reproducible. Three deliberate decisions:
 *
 *  - The system is flat: solid colour fields, concentric rules and one warm
 *    accent. No blurred aurora, no glow. Imagery must sit on the same paper
 *    as the interface.
 *  - Clinician imagery is an abstract composition + monogram, not a synthetic
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

/* ---------- Palette (mirrors src/styles/tokens.css) -------------- */

const IVORY = '#FAF8F3'
const IVORY_2 = '#F3EFE6'
const SAGE = '#EEF3EC'
const SAGE_2 = '#E2EBE0'
const SAGE_DARK = '#CFDCCD'
const FOREST = '#174A32'
const FOREST_DEEP = '#0F3323'
const MOSS = '#347458'
const MOSS_LIGHT = '#4A8F6C'
const LIME = '#D6E255'
const LIME_DEEP = '#BFD13C'
const CLAY = '#C96F4A'

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
 * Flat ground.
 *
 * A solid paper colour, a diagonal band of the next tone up, and concentric
 * rules. Everything is a hard-edged shape — no gradients, no filters — so the
 * imagery reads as part of the same flat layout rather than a separate asset.
 */
function flatGround({ width, height, seed, paper, band, disc, rings }) {
  const rand = seeded(seed)
  const cx = Math.round(width * (0.5 + (rand() - 0.5) * 0.1))
  const cy = Math.round(height * 0.4)
  const r = Math.round(width * 0.3)

  const rule = (radius, opacity, dash) =>
    `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${rings}"
       stroke-opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`

  return `
    <rect width="${width}" height="${height}" fill="${paper}"/>
    <path d="M0 ${height} L${width} ${height - height * 0.42} L${width} ${height} Z" fill="${band}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${disc}"/>
    ${rule(Math.round(r * 1.14), 0.5)}
    ${rule(Math.round(r * 1.3), 0.3, '6 10')}
    ${rule(Math.round(r * 0.72), 0.34)}`
}

/** The FadeWell mark at an arbitrary scale — a curve that fades then recovers. */
function mark(cx, cy, size, ink = LIME, opacity = 1) {
  const s = size / 32
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})" opacity="${opacity}">
    <path d="M7 20.5c2.6 0 3.2-6.5 5.6-6.5s2.6 6.5 5 6.5 2.4-3.4 4.4-3.4"
          fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M7 24.2h18" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" opacity="0.45"/>
  </g>`
}

const NOISE = `<filter id="n" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/>
  </filter>`

/** Barely-there paper grain — texture, not texture-as-effect. */
function grain(width, height, opacity = 0.03) {
  return `<rect width="${width}" height="${height}" filter="url(#n)" opacity="${opacity}"/>`
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${NOISE}${body}</svg>`
}

/**
 * On-brand mixes, one per asset so no two read identically.
 * Each is an ordered set: paper, band, disc, rules.
 */
const PALETTES = {
  amara: { paper: SAGE, band: SAGE_2, disc: FOREST, rings: IVORY },
  rafael: { paper: IVORY, band: SAGE, disc: MOSS, rings: FOREST },
  priya: { paper: SAGE_2, band: IVORY, disc: FOREST_DEEP, rings: CLAY },
  marcus: { paper: IVORY_2, band: SAGE, disc: MOSS_LIGHT, rings: FOREST },
  studio: { paper: SAGE, band: IVORY, disc: FOREST, rings: MOSS },
  brand: { paper: IVORY, band: SAGE_2, disc: FOREST, rings: MOSS }
}

/* ---------- Assets --------------------------------------------- */

/** Abstract flat composition carrying the clinician's initials. */
function clinicianSvg(initials, seed, palette) {
  const w = 720
  const h = 900
  return svg(
    w,
    h,
    `
    ${flatGround({ width: w, height: h, seed, ...palette })}
    <circle cx="${w / 2}" cy="${h * 0.4}" r="132" fill="${FOREST}"/>
    <text x="${w / 2}" y="${h * 0.4 + 34}" text-anchor="middle"
          font-family="Sora, Segoe UI, Helvetica, Arial, sans-serif" font-size="86" font-weight="600"
          letter-spacing="-4" fill="${IVORY}">${initials}</text>
    <text x="${w / 2}" y="${h * 0.4 + 84}" text-anchor="middle"
          font-family="JetBrains Mono, Consolas, monospace" font-size="19" letter-spacing="4"
          fill="${LIME}">FADEWELL CLINICIAN</text>
    <rect x="0" y="${h - 10}" width="${w}" height="10" fill="${LIME_DEEP}"/>
    ${grain(w, h, 0.03)}`
  )
}

/**
 * Brand cover used for the About split and social sharing.
 *
 * Split composition: type on the light paper at the left, a solid forest panel
 * at the right carrying the mark. Type size is fitted to the available column
 * so a long line and a short one both set correctly instead of overflowing.
 */
function coverSvg({ width, height, title, subtitle, seed, palette }) {
  const split = Math.round(width * 0.55)
  const left = Math.round(width * 0.07)
  const col = split - left - Math.round(width * 0.06)
  const panelCx = Math.round((split + width) / 2)
  const panelCy = Math.round(height / 2)

  // Sora semibold averages ~0.52em per glyph; fit the line to the column.
  const fit = (text, max) => Math.max(18, Math.min(max, Math.floor(col / (text.length * 0.52))))
  const titleSize = fit(title, Math.round(height * 0.2))
  const subSize = fit(subtitle, Math.round(height * 0.085))
  const subLines = [subtitle]
  const lineGap = Math.round(subSize * 1.2)
  const blockTop = Math.round(height / 2 - (titleSize + lineGap * subLines.length) / 2)

  const ring = (r, opacity, dash) =>
    `<circle cx="${panelCx}" cy="${panelCy}" r="${r}" fill="none" stroke="${LIME}"
       stroke-opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`

  return svg(
    width,
    height,
    `
    <rect width="${width}" height="${height}" fill="${palette.paper}"/>
    <path d="M0 ${height} L${split} ${Math.round(height * 0.62)} L${split} ${height} Z" fill="${palette.band}"/>
    <rect x="${split}" y="0" width="${width - split}" height="${height}" fill="${FOREST}"/>
    ${ring(Math.round(height * 0.34), 0.22)}
    ${ring(Math.round(height * 0.4), 0.12, '7 12')}
    ${mark(panelCx, panelCy, Math.round(height * 0.3), LIME)}
    <text x="${left}" y="${blockTop}"
          font-family="Sora, Segoe UI, Helvetica, Arial, sans-serif" font-size="${titleSize}"
          font-weight="600" letter-spacing="${-Math.round(titleSize * 0.045)}" fill="${FOREST}">${title}</text>
    ${subLines
      .map(
        (line, i) =>
          `<text x="${left}" y="${blockTop + titleSize + lineGap * (i + 0.75)}"
             font-family="Instrument Serif, Georgia, serif" font-style="italic"
             font-size="${subSize}" fill="${MOSS}">${line}</text>`
      )
      .join('')}
    <rect x="${left}" y="${Math.round(height * 0.78)}" width="${Math.round(width * 0.1)}" height="6" rx="3" fill="${FOREST}"/>
    <rect x="${left + Math.round(width * 0.11)}" y="${Math.round(height * 0.78)}" width="${Math.round(width * 0.06)}" height="6" rx="3" fill="${LIME_DEEP}"/>
    <text x="${left}" y="${Math.round(height * 0.88)}"
          font-family="JetBrains Mono, Consolas, monospace" font-size="${Math.round(width * 0.014)}"
          letter-spacing="6" fill="${MOSS}">FADEWELL.COM</text>
    ${grain(width, height, 0.03)}`
  )
}

function iconSvg(size, rounded) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rounded}" fill="${FOREST}"/>
    ${mark(size / 2, size / 2, size * 0.74)}
  </svg>`
}

/* ---------- Write ---------------------------------------------- */

async function writeWebp(name, markup) {
  await sharp(Buffer.from(markup)).webp({ quality: 86 }).toFile(join(assets, name))
  console.log(`  assets/${name}`)
}

async function writePng(name, markup) {
  await sharp(Buffer.from(markup)).png().toFile(join(publicDir, name))
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
  await sharp(Buffer.from(ogMarkup)).png().toFile(join(assets, 'og-cover.png'))
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
