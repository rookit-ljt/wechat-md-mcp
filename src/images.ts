import fs from 'node:fs'
import path from 'node:path'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

function isRemote(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('#')
}

/**
 * Turns relative image paths in the rendered HTML into data URIs so the preview
 * shows them instead of broken-image icons.
 *
 * Preview only. WeChat does not accept data URIs — the caller still has to warn
 * that local images must be uploaded to an image host before publishing.
 *
 * Reads are confined to `baseDir` and limited to image extensions, so a crafted
 * `![](../../etc/passwd)` in the Markdown cannot reach outside the article dir.
 */
export function inlineLocalImages(html: string, baseDir: string) {
  const root = path.resolve(baseDir)
  const missing: string[] = []
  let inlined = 0

  const out = html.replace(/(<img\b[^>]*?\bsrc=["'])([^"']*)(["'])/gi, (full, before, rawSrc, after) => {
    if (isRemote(rawSrc))
      return full

    let src = rawSrc
    try {
      src = decodeURIComponent(rawSrc)
    }
    catch {
      // keep the raw form
    }

    const target = path.resolve(root, src)
    if (target !== root && !target.startsWith(root + path.sep)) {
      missing.push(rawSrc)
      return full
    }

    const ext = path.extname(target).toLowerCase()
    if (!MIME[ext]) {
      missing.push(rawSrc)
      return full
    }

    try {
      const stat = fs.statSync(target)
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
        missing.push(rawSrc)
        return full
      }
      const data = fs.readFileSync(target).toString('base64')
      inlined++
      return `${before}data:${MIME[ext]};base64,${data}${after}`
    }
    catch {
      missing.push(rawSrc)
      return full
    }
  })

  return { html: out, inlined, missing: [...new Set(missing)] }
}
