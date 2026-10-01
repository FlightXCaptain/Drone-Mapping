/**
 * Controller bridge: lets the app (served from this PC) put a mission straight onto a DJI RC 2 /
 * DJI RC / Android phone plugged in by USB. Browsers can't reach MTP devices, so this runs in the
 * dev/preview server and calls tools/send-to-dji-fly.ps1.
 *
 *   GET  /api/rc        → controller + DJI Fly missions on it
 *   GET  /api/rc/mission/<uuid> → read-only copy of that mission's KMZ (base64)
 *   POST /api/rc/send   → { kmzBase64, mission, whatIf? } replaces that mission's KMZ
 *
 * Only requests from this PC itself are accepted, so nobody else on the network can write to a
 * plugged-in controller.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

const SCRIPT = fileURLToPath(new URL('../tools/send-to-dji-fly.ps1', import.meta.url))

function localAddresses(): Set<string> {
  const set = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      set.add(a.address)
      set.add(`::ffff:${a.address}`)
    }
  }
  return set
}

function runScript(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Json', ...args],
      { timeout: 120_000, windowsHide: true },
      (err, stdout) => {
        const line = stdout.split(/\r?\n/).find((l) => l.startsWith('##RESULT '))
        if (line) return done(JSON.parse(line.slice(9)))
        done({ ok: false, error: err ? `The controller helper failed: ${err.message}` : 'No response from the controller helper.' })
      },
    )
  })
}

function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) fail(new Error('Mission file too large'))
      else chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
    req.on('error', fail)
  })
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// The controller can only do one thing at a time, so requests queue rather than fail.
let queue: Promise<unknown> = Promise.resolve()
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => {})
  return run
}

const handler: Connect.NextHandleFunction = async (req, res, next) => {
  if (!req.url?.startsWith('/api/rc')) return next()
  const local = localAddresses()
  if (!local.has(req.socket.remoteAddress ?? '')) {
    return json(res, 403, { ok: false, error: 'Sending to a controller only works from the PC it is plugged into.' })
  }
  // A website open in this PC's browser also connects from a local address, so additionally:
  //  - Host must be this machine (defeats DNS rebinding, where evil.example resolves to us);
  //  - Origin, when sent, must be that same host (blocks cross-site form/fetch posts);
  //  - a custom header is required, which cross-site requests can't add without a CORS
  //    preflight that we never approve.
  const hostName = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  const allowedHosts = new Set(['localhost', ...[...local].filter((a) => !a.startsWith('::ffff:'))])
  if (!allowedHosts.has(hostName)) return json(res, 403, { ok: false, error: 'Request not from this app.' })
  const origin = req.headers.origin
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host.toLowerCase()
    } catch {
      /* invalid origin */
    }
    if (originHost !== (req.headers.host ?? '').toLowerCase()) return json(res, 403, { ok: false, error: 'Request not from this app.' })
  }
  if (req.headers['x-drone-mapping'] !== '1') return json(res, 403, { ok: false, error: 'Request not from this app.' })
  if (process.platform !== 'win32') return json(res, 501, { ok: false, error: 'The controller bridge needs Windows.' })
  await serialised(() => handle(req, res))
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method === 'GET' && req.url === '/api/rc') {
      return json(res, 200, await runScript(['-List']))
    }
    const fetchMatch = req.method === 'GET' && req.url?.match(/^\/api\/rc\/mission\/([0-9A-Fa-f-]{36})$/)
    if (fetchMatch) {
      // Read-only copy of what's on the controller, so the app can show it on a map.
      const dir = await mkdtemp(join(tmpdir(), 'drone-mapping-'))
      const file = join(dir, 'fetched.kmz')
      try {
        const r = await runScript(['-Fetch', '-Mission', fetchMatch[1], '-Out', file])
        if (!r.ok) return json(res, 200, r)
        return json(res, 200, { ok: true, mission: fetchMatch[1], kmzBase64: (await readFile(file)).toString('base64') })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
    if (req.method === 'POST' && req.url === '/api/rc/send') {
      const { kmzBase64, mission, whatIf } = JSON.parse(await readBody(req)) as { kmzBase64: string; mission: string; whatIf?: boolean }
      if (!/^[0-9A-Fa-f-]{36}$/.test(mission ?? '')) return json(res, 400, { ok: false, error: 'Choose a placeholder mission.' })
      const dir = await mkdtemp(join(tmpdir(), 'drone-mapping-'))
      const file = join(dir, 'mission.kmz')
      try {
        await writeFile(file, Buffer.from(kmzBase64, 'base64'))
        return json(res, 200, await runScript(['-Kmz', file, '-Mission', mission, ...(whatIf ? ['-WhatIf'] : [])]))
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
    json(res, 404, { ok: false, error: 'Unknown controller request.' })
  } catch (e) {
    json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

export function rcBridge(): Plugin {
  return {
    name: 'drone-mapping-rc-bridge',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}
