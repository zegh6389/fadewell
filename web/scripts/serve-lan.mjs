/**
 * Serve MmjGreen on the local network, so a phone or another laptop can open it.
 *
 * Two processes, deliberately split:
 *
 *   - the API stays bound to 127.0.0.1. Nothing but this machine can reach it.
 *     Vite proxies `/api` to it server-side, so the browser never speaks to the
 *     API port directly and the care workspaces are not exposed to the LAN.
 *   - `vite preview` binds 0.0.0.0 and is the only thing on the network.
 *
 * The fiddly part is `APP_ORIGIN`. The API refuses any state-changing request
 * whose Origin it does not recognise, and it matches exactly — so the address
 * you actually type in the browser has to be the one it was told about. Getting
 * this wrong is not a crash, it is a site that loads and then fails to sign
 * anyone in, which is a genuinely confusing thing to debug. So this script
 * passes both the loopback and the LAN origin and prints the URL to use.
 *
 *   npm run lan            # from web/
 *   node scripts/serve-lan.mjs
 */

import { spawn, execFileSync } from 'node:child_process'
import { networkInterfaces, platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const PORT = Number(process.env.PORT ?? 4173)
const API_PORT = 3001

/**
 * The address other devices will use.
 *
 * `os.networkInterfaces()` alone is not enough on a developer machine: this one
 * has a WSL virtual switch, a Hyper-V adapter and a VPN, and any of them may be
 * listed first. The address that matters belongs to the interface holding the
 * default route, so ask the OS which one that is. Virtual adapters rarely carry
 * a default gateway, which is what makes this reliable rather than a guess.
 */
function lanAddress() {
  if (platform() === 'win32') {
    try {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' }" +
            ' | Select-Object -First 1 -ExpandProperty IPv4Address' +
            ' | Select-Object -ExpandProperty IPAddress'
        ],
        { encoding: 'utf8', timeout: 10_000 }
      ).trim()
      if (out) return out
    } catch {
      // Fall through to the portable path below.
    }
  }

  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addrs]) =>
      (addrs ?? [])
        .filter((a) => a.family === 'IPv4' && !a.internal)
        .map((a) => ({ name, address: a.address }))
    )
    .filter(({ name }) => !/virtual|vmware|vbox|docker|wsl|hyper-v|loopback/i.test(name))

  return candidates[0]?.address ?? null
}

const lan = lanAddress()
if (!lan) {
  console.error('Could not find a LAN address. Connect to Wi-Fi or Ethernet and retry.')
  process.exit(1)
}

const LAN_ORIGIN = `http://${lan}:${PORT}`
const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`

const children = []
function run(name, command, args, options) {
  const child = spawn(command, args, { cwd: WEB, stdio: 'inherit', ...options })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n${name} exited with code ${code}`)
      shutdown(code ?? 1)
    }
  })
  children.push(child)
  return child
}

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log(`LAN address : ${lan}`)
console.log(`Serving on  : ${LAN_ORIGIN}\n`)

run('api', process.execPath, ['--experimental-strip-types', '../api/tests/browser-server.ts'], {
  env: {
    ...process.env,
    // Loopback is canonical so any generated link is a real one; the LAN origin
    // is allowed alongside it purely so the same build serves both.
    APP_ORIGIN: LOCAL_ORIGIN,
    APP_ORIGINS: LAN_ORIGIN,
    NODE_ENV: process.env.NODE_ENV ?? 'test'
  }
})

run('web', process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '0.0.0.0', '--port', String(PORT)], {})

setTimeout(() => {
  console.log('\n  On this machine :', LOCAL_ORIGIN)
  console.log('  On your network :', LAN_ORIGIN)
  console.log('  Patient sign-in: /patient     Clinician: /portal\n')
  console.log('  Ctrl-C to stop both.\n')
}, 2500)
