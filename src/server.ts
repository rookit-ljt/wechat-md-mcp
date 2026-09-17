import http from 'node:http'
import fs from 'node:fs/promises'
import { renderWechatHtml } from './render'
import { THEMES } from './render'

const PORT = Number(process.env.MD_SERVICE_PORT || 8788)
const HOST = process.env.MD_SERVICE_HOST || '127.0.0.1'

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)

  if (req.method === 'OPTIONS')
    return send(res, 204, {})

  try {
    if (url.pathname === '/health' && req.method === 'GET')
      return send(res, 200, { ok: true, service: 'md-service', uptime: process.uptime() })

    if (url.pathname === '/themes' && req.method === 'GET')
      return send(res, 200, { themes: THEMES })

    if (url.pathname === '/render' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.markdown && !body.path)
        return send(res, 400, bad('Provide either `markdown` or `path`.'))
      const markdown = body.markdown ?? await fs.readFile(body.path, 'utf-8')
      const result = await renderWechatHtml({ ...body, markdown })
      return send(res, 200, result)
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

server.listen(PORT, HOST, () => {
  process.stdout.write(`[wechat-md-mcp] listening on http://${HOST}:${PORT}\n`)
  process.stdout.write(`[wechat-md-mcp] POST /render  {"markdown"|"path", theme, inline}\n`)
  process.stdout.write(`[wechat-md-mcp] GET  /themes  GET /health\n`)
})
