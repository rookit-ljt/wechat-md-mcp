import fs from 'node:fs/promises'
import { renderWechatHtml, DEFAULT_OPTIONS, THEMES } from '../src/render'

const SRC = process.argv[2]
const OUT = process.argv[3] || 'outputs/preview.html'
const THEME = process.argv[4] || 'default'

const markdown = await fs.readFile(SRC, 'utf-8')
const started = Date.now()
const { html, frontMatter, readingTime } = await renderWechatHtml({
  markdown,
  theme: THEME,
  primaryColor: '#0F4C81',
  isMacCodeBlock: true,
  countStatus: true,
})
const elapsed = Date.now() - started

const problems = {
  'var(--': (html.match(/var\(--/g) || []).length,
  'hsl(': (html.match(/hsl\(/g) || []).length,
  'color-mix(': (html.match(/color-mix\(/g) || []).length,
  'calc(': (html.match(/calc\(/g) || []).length,
  undefined: (html.match(/undefined/g) || []).length,
}

console.log('source      :', SRC)
console.log('theme       :', THEME)
console.log('render ms   :', elapsed)
console.log('readingTime :', JSON.stringify(readingTime))
console.log('frontMatter :', JSON.stringify(frontMatter))
console.log('html bytes  :', Buffer.byteLength(html, 'utf-8'))
console.log('problems    :', JSON.stringify(problems))

const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>md-service preview - ${THEME}</title>
<style>
  body { margin: 0; background: #f2f3f5; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
  .bar { position: sticky; top: 0; z-index: 9; display: flex; gap: 8px; align-items: center;
         padding: 12px 16px; background: #fff; border-bottom: 1px solid #e5e6eb; }
  .bar strong { font-size: 14px; color: #1d2129; }
  .bar span { font-size: 12px; color: #86909c; }
  .wrap { max-width: 375px; margin: 24px auto; background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,.08); }
  .phone { padding: 20px 16px; overflow-wrap: break-word; word-break: break-word; }
</style>
</head>
<body>
<div class="bar">
  <strong>md-service 预览</strong>
  <span>主题=${THEME} · ${readingTime.words} 字 · 渲染 ${elapsed}ms · ${Buffer.byteLength(html, 'utf-8')} bytes</span>
</div>
<div class="wrap"><div class="phone">${html}</div></div>
</body>
</html>`

const abs = OUT.startsWith('/') ? OUT : `${process.cwd()}/${OUT}`
await fs.mkdir(`${abs.slice(0, abs.lastIndexOf('/'))}`, { recursive: true })
await fs.writeFile(abs, page, 'utf-8')
console.log('preview     :', abs)
console.log('themes      :', THEMES.map(t => `${t.value}=${t.label}`).join(' / '))
