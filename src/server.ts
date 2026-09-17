import http from 'node:http'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { renderWechatHtml, THEMES } from './render'
import { copyHtmlToClipboard } from './clipboard'
import { inlineLocalImages } from './images'
import { omitBlanks, readState, stateFilePath, writeState } from './state'

const PORT = Number(process.env.MD_SERVICE_PORT || 8788)
const HOST = process.env.MD_SERVICE_HOST || '127.0.0.1'
const WEB_DIR = path.resolve(import.meta.dirname, '../web')

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function send(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  })
  res.end(body)
}

function sendFile(res: http.ServerResponse, status: number, body: string | Buffer, type: string) {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => raw += chunk)
    req.on('end', () => {
      if (!raw)
        return resolve({})
      try {
        resolve(JSON.parse(raw))
      }
      catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function bad(message: string) {
  return { error: { code: 'bad_request', message } }
}

/** Confines a static asset path to WEB_DIR — no `../` escapes. */
function resolveWebFile(rel: string): string | null {
  const target = path.resolve(WEB_DIR, rel)
  if (target !== WEB_DIR && !target.startsWith(WEB_DIR + path.sep))
    return null
  return target
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)

  if (req.method === 'OPTIONS')
    return send(res, 204, {})

  try {
    // ---- editor page + static assets ----
    if (url.pathname === '/' && req.method === 'GET') {
      if (!fsSync.existsSync(path.join(WEB_DIR, 'index.html')))
        return send(res, 404, bad('web/index.html is missing.'))
      return sendFile(res, 200, await fs.readFile(path.join(WEB_DIR, 'index.html'), 'utf-8'), STATIC_TYPES['.html'])
    }

    if (url.pathname.startsWith('/web/') && req.method === 'GET') {
      const target = resolveWebFile(url.pathname.slice('/web/'.length))
      if (!target || !fsSync.existsSync(target))
        return send(res, 404, bad(`Not found: ${url.pathname}`))
      const type = STATIC_TYPES[path.extname(target)] || 'application/octet-stream'
      return sendFile(res, 200, await fs.readFile(target), type)
    }

    // ---- existing API ----
    if (url.pathname === '/health' && req.method === 'GET')
      return send(res, 200, { ok: true, service: 'wechat-md-mcp', uptime: process.uptime() })

    if (url.pathname === '/themes' && req.method === 'GET')
      return send(res, 200, { themes: THEMES })

    if (url.pathname === '/render' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.markdown && !body.path)
        return send(res, 400, bad('Provide either `markdown` or `path`.'))

      const markdown = body.markdown ?? await fs.readFile(body.path, 'utf-8')
      // Saved editor settings act as defaults; anything passed explicitly wins.
      const saved = omitBlanks(await readState())
      const result = await renderWechatHtml({ ...saved, ...body, markdown })

      if (body.baseDir) {
        const { html, inlined, missing } = inlineLocalImages(result.html, body.baseDir)
        result.html = html
        return send(res, 200, { ...result, images: { inlined, missing } })
      }
      return send(res, 200, result)
    }

    // ---- editor support ----
    if (url.pathname === '/open' && req.method === 'POST') {
      const { path: target } = await readBody(req)
      if (!target)
        return send(res, 400, bad('Provide `path`.'))
      const absolute = path.resolve(target)
      const markdown = await fs.readFile(absolute, 'utf-8')
      return send(res, 200, {
        path: absolute,
        name: path.basename(absolute),
        baseDir: path.dirname(absolute),
        markdown,
      })
    }

    if (url.pathname === '/save' && req.method === 'POST') {
      const { path: target, markdown } = await readBody(req)
      if (!target || typeof markdown !== 'string')
        return send(res, 400, bad('Provide `path` and `markdown`.'))
      const absolute = path.resolve(target)
      // Keep one backup before overwriting — this is a destructive route.
      try {
        await fs.copyFile(absolute, `${absolute}.bak`)
      }
      catch {
        // first save of a new file, nothing to back up
      }
      await fs.writeFile(absolute, markdown, 'utf-8')
      return send(res, 200, { saved: absolute, backup: `${absolute}.bak` })
    }

    if (url.pathname === '/config' && req.method === 'GET') {
      const state = await readState()
      return send(res, 200, { state, file: stateFilePath() })
    }

    if (url.pathname === '/config' && req.method === 'POST') {
      const body = await readBody(req)
      const state = await writeState(body.state ?? body)
      return send(res, 200, { state, file: stateFilePath() })
    }

    if (url.pathname === '/clipboard' && req.method === 'POST') {
      const { html } = await readBody(req)
      if (!html)
        return send(res, 400, bad('Provide `html`.'))
      await copyHtmlToClipboard(html)
      return send(res, 200, { copied: html.length })
    }

    if (url.pathname === '/preview' && req.method === 'POST') {
      const { html } = await readBody(req)
      if (!html)
        return send(res, 400, bad('Provide `html`.'))
      const target = path.join(os.tmpdir(), `md-preview-${Date.now()}.html`)
      await fs.writeFile(target, html, 'utf-8')
      execFile('open', [target])
      return send(res, 200, { preview: target })
    }

    return send(res, 404, bad(`Unknown route: ${req.method} ${url.pathname}`))
  }
  catch (err: any) {
    return send(res, 500, {
      error: {
        code: 'render_failed',
        message: err?.message || String(err),
      },
    })
  }
})

/**
 * Port 8788 is shared with anything else that might grab it. Rather than dying,
 * walk forward a few ports so `npm start` never fails on a stale process.
 */
function listen(port: number, attempt = 0) {
  server.once('error', (err: any) => {
    if (err?.code === 'EADDRINUSE' && attempt < 10) {
      process.stdout.write(`[wechat-md-mcp] port ${port} in use, trying ${port + 1}\n`)
      listen(port + 1, attempt + 1)
    }
    else {
      process.stderr.write(`[wechat-md-mcp] fatal: ${err?.message || err}\n`)
      process.exit(1)
    }
  })
  server.listen(port, HOST, () => {
    boundPort = port
    process.stdout.write(`[wechat-md-mcp] listening on http://${HOST}:${port}\n`)
    process.stdout.write(`[wechat-md-mcp] editor    http://${HOST}:${port}/\n`)
    process.stdout.write(`[wechat-md-mcp] POST /render  {"markdown"|"path", theme, inline}\n`)
    process.stdout.write(`[wechat-md-mcp] GET  /themes  GET /health\n`)
  })
}

let boundPort = PORT

export function currentPort(): number {
  return boundPort
}

listen(PORT)
