import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = new URL('../public/assets/', import.meta.url)
const photos = {
  'care-conversation': 'photo-1576091160399-112ba8d25d1d',
  'care-preparation': 'photo-1576091160550-2173dba999ef',
  'care-workspace': 'photo-1497366811353-6870744d04b2',
  'botanical-leaves': 'photo-1485955900006-10f4d324d411'
}

for (const [name, id] of Object.entries(photos)) {
  const url = `https://images.unsplash.com/${id}?w=1200&q=85&fit=crop`
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${name}: ${response.status}`)
  const image = await sharp(Buffer.from(await response.arrayBuffer())).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 84 }).toBuffer()
  await writeFile(new URL(`${name}.webp`, root), image)
  console.log(`${name}.webp: ${Math.round(image.length / 1024)} KB`)
}
await writeFile(new URL('editorial-sources.txt', root), Object.entries(photos).map(([name, id]) => `${name}: https://images.unsplash.com/${id}\nEditorial stock photography; not an actual MyFloraMD clinician, patient, or office.\n`).join('\n'))
