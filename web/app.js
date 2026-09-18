'use strict'

const $ = id => document.getElementById(id)

const els = {
  editor: $('editor'),
  preview: $('preview'),
  mirror: $('mirror'),
  syncToggle: $('sync-scroll'),
  dirty: $('dirty'),
  filename: $('filename'),
  filepath: $('filepath'),
  status: $('status'),
  inlineMode: $('inline-mode'),
}

const CONFIG_KEYS = [
  'theme', 'primaryColor', 'fontSize', 'lineHeight',
  'isMacCodeBlock', 'isShowLineNumber', 'citeStatus',
  'countStatus', 'isUseIndent', 'isUseJustify',
  'codeBlockTheme', 'customCSS',
]

const state = {
  path: null,
  baseDir: null,
  dirty: false,
  config: {},
}

let renderTimer = null
let renderSeq = 0

function setStatus(text, warn = false) {
  els.status.textContent = text
  els.status.classList.toggle('warn', warn)
}

function markDirty(dirty) {
  state.dirty = dirty
  els.dirty.classList.toggle('on', dirty)
}

async function api(route, body, method = 'POST') {
  const res = await fetch(route, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.error)
    throw new Error(data?.error?.message || `请求失败：${route}`)
  return data
}

/* ---------------- rendering ---------------- */

function collectConfig() {
  const cfg = {}
  for (const key of CONFIG_KEYS) {
    const el = $(`cfg-${key}`)
    if (!el)
      continue
    cfg[key] = el.type === 'checkbox' ? el.checked : el.value
  }
  return cfg
}

async function requestRender({ inline }) {
  const markdown = els.editor.value
  if (!markdown.trim()) {
    els.preview.srcdoc = ''
    return null
  }
  state.config = collectConfig()
  return api('/render', {
    markdown,
    baseDir: state.baseDir,
    inline,
    ...state.config,
  })
}

function injectPreview(html) {
  // srcdoc keeps the theme CSS from leaking into the editor's own UI.
  els.preview.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:14px 16px;background:#fff}
img{max-width:100%}</style></head><body>${html}</body></html>`
}

async function refreshPreview() {
  const seq = ++renderSeq
  try {
    const data = await requestRender({ inline: els.inlineMode.checked })
    if (!data || seq !== renderSeq)
      return
    injectPreview(data.html)

    const img = data.images || { inlined: 0, missing: [] }
    const parts = []
    if (img.inlined)
      parts.push(`本地图内联 ${img.inlined} 张（预览用，微信不支持 data URI）`)
    if (img.missing.length)
      parts.push(`找不到 ${img.missing.length} 张图：${img.missing.slice(0, 3).join('、')}`)
    if (parts.length)
      setStatus(parts.join(' · '), img.missing.length > 0)
    else
      setStatus(`已渲染 · ${data.readingTime.words} 字`)
  }
  catch (err) {
    if (seq === renderSeq)
      setStatus(String(err.message || err), true)
  }
}

function schedulePreview() {
  clearTimeout(renderTimer)
  renderTimer = setTimeout(refreshPreview, 250)
}

/* ---------------- file handling ---------------- */

async function openByPath(target) {
  const data = await api('/open', { path: target })
  state.path = data.path
  state.baseDir = data.baseDir
  els.editor.value = data.markdown
  els.filename.textContent = data.name
  els.filepath.textContent = data.path
  markDirty(false)
  await refreshPreview()
}

function loadFromFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    els.editor.value = String(reader.result || '')
    // A browser File has no path, so there is nothing to save back to.
    state.path = null
    state.baseDir = null
    els.filename.textContent = file.name
    els.filepath.textContent = ''
    markDirty(true)
    setStatus('从浏览器读取，无本地路径 —— 保存时会询问保存位置')
    refreshPreview()
  }
  reader.readAsText(file)
}

async function saveMarkdown() {
  let target = state.path
  if (!target) {
    target = window.prompt('保存到哪个绝对路径？', '')
    if (!target)
      return
    state.path = target
    state.baseDir = null
  }
  await api('/save', { path: target, markdown: els.editor.value })
  els.filepath.textContent = state.path
  markDirty(false)
  setStatus(`已保存 ${state.path}（原文件备份为 .bak）`)
}

async function saveHtml() {
  const data = await requestRender({ inline: true })
  if (!data)
    return setStatus('没有内容可保存', true)
  const blob = new Blob([data.html], { type: 'text/html;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(els.filename.textContent || 'article').replace(/\.md$/i, '')}.html`
  a.click()
  URL.revokeObjectURL(a.href)
  setStatus('HTML 已下载')
}

async function copyRichText() {
  const data = await requestRender({ inline: true })
  if (!data)
    return setStatus('没有内容可复制', true)
  await api('/clipboard', { html: data.html })
  setStatus('已写入剪贴板，去公众号后台 Cmd+V')
}

async function openInBrowser() {
  const data = await requestRender({ inline: true })
  if (!data)
    return setStatus('没有内容可预览', true)
  await api('/preview', { html: data.html })
  setStatus('已在默认浏览器打开')
}

/* ---------------- config panel ---------------- */

function bindConfig() {
  for (const key of CONFIG_KEYS) {
    const el = $(`cfg-${key}`)
    if (!el)
      continue
    el.addEventListener('input', () => {
      if (key === 'primaryColor')
        $('cfg-primaryColorText').value = el.value
      schedulePreview()
    })
    el.addEventListener('change', schedulePreview)
  }
  $('cfg-primaryColorText').addEventListener('input', (e) => {
    const v = e.target.value.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v))
      $('cfg-primaryColor').value = v
    schedulePreview()
  })
}

function applyConfigToInputs(state2) {
  for (const key of CONFIG_KEYS) {
    const el = $(`cfg-${key}`)
    if (!el || state2[key] === undefined)
      continue
    if (el.type === 'checkbox')
      el.checked = !!state2[key]
    else
      el.value = state2[key]
  }
  const color = state2.primaryColor || '#0F4C81'
  $('cfg-primaryColor').value = color
  $('cfg-primaryColorText').value = color
}

async function loadConfig() {
  const data = await api('/config', undefined, 'GET')
  state.config = data.state
  applyConfigToInputs(data.state)
}

async function saveConfigAsDefault() {
  const saved = await api('/config', { state: collectConfig() })
  setStatus(`已存为默认配置：${saved.file}`)
}

/* ---------------- toolbar ---------------- */

function surround(before, after = before) {
  const el = els.editor
  const { selectionStart: s, selectionEnd: e, value } = el
  const picked = value.slice(s, e) || '文字'
  el.value = value.slice(0, s) + before + picked + after + value.slice(e)
  el.focus()
  el.setSelectionRange(s + before.length, s + before.length + picked.length)
  markDirty(true)
  schedulePreview()
}

function insert(text) {
  const el = els.editor
  const { selectionStart: s, selectionEnd: e, value } = el
  el.value = value.slice(0, s) + text + value.slice(e)
  el.focus()
  el.setSelectionRange(s + text.length, s + text.length)
  markDirty(true)
  schedulePreview()
}

function prefixLines(prefix) {
  const el = els.editor
  const { selectionStart: s, selectionEnd: e, value } = el
  const start = value.lastIndexOf('\n', s - 1) + 1
  const end = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e)
  const block = value.slice(start, end) || '文字'
  const out = block.split('\n').map(l => prefix + l).join('\n')
  el.value = value.slice(0, start) + out + value.slice(end)
  el.focus()
  markDirty(true)
  schedulePreview()
}

function bindToolbar() {
  document.querySelectorAll('.toolbar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.wrap)
        surround(btn.dataset.wrap)
      else if (btn.dataset.insert)
        insert(btn.dataset.insert)
      else if (btn.dataset.block)
        insert(btn.dataset.block.replace(/\\n/g, '\n'))
      else if (btn.dataset.prefix)
        prefixLines(btn.dataset.prefix)
    })
  })
}

/* ---------------- scroll sync ----------------
 *
 * The editor is a plain textarea (no per-line DOM) and the preview lives in an
 * iframe, so neither side knows where the other's content sits. We measure both
 * sides per markdown block and interpolate inside the block the viewport is in.
 * Blocks are matched by index: the renderer emits exactly one top-level element
 * per source block, verified against real articles.
 */

const SYNC_KEY = 'md-scroll-sync'
const LEADER_MS = 200

const sync = {
  on: true,
  mode: 'ratio',
  src: null,   // { tops: [block0..blockN, end], ... }
  prev: null,
  leader: null,
  leaderUntil: 0,
  raf: 0,
}

/** Split markdown into top-level blocks; fenced code is never split. */
function blocksOf(text) {
  const out = []
  let cur = []
  let inCode = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode
      cur.push(line)
      continue
    }
    if (!inCode && !line.trim()) {
      if (cur.length) {
        out.push(cur.join('\n'))
        cur = []
      }
      continue
    }
    cur.push(line)
  }
  if (cur.length)
    out.push(cur.join('\n'))
  return out
}

function previewWin() {
  try {
    return els.preview.contentWindow
  }
  catch {
    return null
  }
}

function previewDoc() {
  try {
    return els.preview.contentDocument
  }
  catch {
    return null
  }
}

/**
 * Measure where each block sits inside the textarea. A textarea exposes no
 * geometry for its text, so we replay the same text into a hidden mirror that
 * copies every metric affecting layout, then read the anchors back.
 */
function measureEditorSide(blocks) {
  const ta = els.editor
  const m = els.mirror
  const cs = getComputedStyle(ta)

  m.style.width = `${ta.clientWidth}px`
  m.style.boxSizing = 'border-box'
  m.style.padding = cs.padding
  for (const prop of [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform',
    'textIndent', 'tabSize', 'direction',
  ])
    m.style[prop] = cs[prop]

  m.textContent = ''
  const spans = []
  for (let i = 0; i < blocks.length; i++) {
    if (i)
      m.appendChild(document.createTextNode('\n\n'))
    const span = document.createElement('span')
    span.textContent = blocks[i]
    m.appendChild(span)
    spans.push(span)
  }
  if (!spans.length)
    return null

  const base = m.getBoundingClientRect().top + parseFloat(cs.paddingTop || 0)
  const tops = spans.map(s => s.getBoundingClientRect().top - base)
  const last = spans[spans.length - 1].getBoundingClientRect()
  tops.push(last.bottom - base)
  return { tops }
}

function measurePreviewSide() {
  const w = previewWin()
  const doc = previewDoc()
  if (!w || !doc)
    return null

  const container = doc.querySelector('.container') || doc.body
  // The renderer parks theme <style> tags inside the container; they are not
  // content blocks and would break the one-to-one match with source blocks.
  const skip = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'TITLE'])
  const kids = Array.from(container.children).filter(el => !skip.has(el.tagName))
  const scrolled = w.scrollY || doc.documentElement.scrollTop || 0
  const tops = kids.map(el => el.getBoundingClientRect().top + scrolled)
  const lastBottom = kids.length
    ? kids[kids.length - 1].getBoundingClientRect().bottom + scrolled
    : 0

  return {
    tops,
    lastBottom,
    end: Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight || 0),
    client: w.innerHeight || doc.documentElement.clientHeight,
  }
}

let measureTimer = null

function scheduleMeasure() {
  clearTimeout(measureTimer)
  measureTimer = setTimeout(measureAll, 150)
}

function measureAll() {
  const blocks = blocksOf(els.editor.value)
  sync.src = measureEditorSide(blocks)
  const prev = measurePreviewSide()
  sync.prev = prev

  if (!sync.src || !prev) {
    sync.mode = 'ratio'
    return
  }

  // Both sides need tops.length === blocks.length + 1 for index pairing.
  const matched = prev.tops.length === blocks.length
  if (prev.tops.length)
    prev.tops.push(prev.lastBottom)
  sync.mode = matched ? 'block' : 'ratio'
}

/** Map a scroll position across sides by piecewise interpolation per block. */
function mapTop(y, from, to) {
  const n = from.tops.length - 1
  if (n <= 0)
    return 0

  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (from.tops[mid + 1] <= y)
      lo = mid + 1
    else
      hi = mid
  }
  const i = Math.min(lo, n - 1)
  const a = from.tops[i]
  const b = from.tops[i + 1]
  const r = b > a ? Math.min(1, Math.max(0, (y - a) / (b - a))) : 0
  return to.tops[i] + r * (to.tops[i + 1] - to.tops[i])
}

function maxScroll(el) {
  return Math.max(0, el.scrollHeight - el.clientHeight)
}

function applySync(source) {
  if (!sync.src || !sync.prev)
    return

  const w = previewWin()
  if (!w)
    return

  const srcMax = maxScroll(els.editor)
  const prevMax = Math.max(0, sync.prev.end - sync.prev.client)

  if (source === 'editor') {
    const y = els.editor.scrollTop
    const raw = sync.mode === 'block'
      ? mapTop(y, sync.src, sync.prev)
      : (srcMax > 0 ? y / srcMax * prevMax : 0)
    // Scroll-to-bottom should land on the other side's bottom, not short of it.
    const target = srcMax > 0 && y >= srcMax * 0.98
      ? prevMax
      : Math.min(prevMax, Math.max(0, raw))
    w.scrollTo(0, target)
  }
  else {
    const y = w.scrollY
    const raw = sync.mode === 'block'
      ? mapTop(y, sync.prev, sync.src)
      : (prevMax > 0 ? y / prevMax * srcMax : 0)
    const target = prevMax > 0 && y >= prevMax * 0.98
      ? srcMax
      : Math.min(srcMax, Math.max(0, raw))
    els.editor.scrollTop = target
  }
}

/**
 * Whoever scrolls first owns the sync for a short window. Without this the two
 * sides keep re-triggering each other and the scroll fights itself.
 */
function requestSync(source) {
  if (!sync.on)
    return
  const now = performance.now()
  if (sync.leader && sync.leader !== source && now < sync.leaderUntil)
    return
  sync.leader = source
  sync.leaderUntil = now + LEADER_MS
  if (sync.raf)
    return
  sync.raf = requestAnimationFrame(() => {
    sync.raf = 0
    applySync(source)
  })
}

function onPreviewLoad() {
  const w = previewWin()
  if (w)
    w.addEventListener('scroll', () => requestSync('preview'), { passive: true })

  // Images settle after load and push content down, so measure again.
  const doc = previewDoc()
  if (doc) {
    for (const img of Array.from(doc.images)) {
      if (!img.complete)
        img.addEventListener('load', scheduleMeasure, { once: true })
    }
  }
  scheduleMeasure()
}

function initSync() {
  sync.on = localStorage.getItem(SYNC_KEY) !== 'off'
  els.syncToggle.checked = sync.on

  els.syncToggle.addEventListener('change', () => {
    sync.on = els.syncToggle.checked
    localStorage.setItem(SYNC_KEY, sync.on ? 'on' : 'off')
    if (sync.on) {
      measureAll()
      applySync('editor')
    }
  })

  els.editor.addEventListener('scroll', () => requestSync('editor'), { passive: true })
  els.preview.addEventListener('load', onPreviewLoad)
  window.addEventListener('resize', scheduleMeasure)
}

/* ---------------- wiring ---------------- */

function bindGlobal() {
  els.editor.addEventListener('input', () => {
    markDirty(true)
    schedulePreview()
  })

  els.inlineMode.addEventListener('change', refreshPreview)

  $('btn-open').addEventListener('click', async () => {
    const target = window.prompt('输入 .md 文件的绝对路径', state.path || '')
    if (!target)
      return
    try {
      await openByPath(target)
    }
    catch (err) {
      setStatus(String(err.message || err), true)
    }
  })

  // Drop a .md onto the editor to load it (content only, no path).
  els.editor.addEventListener('dragover', e => e.preventDefault())
  els.editor.addEventListener('drop', (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file)
      loadFromFile(file)
  })

  $('btn-save').addEventListener('click', () => {
    saveMarkdown().catch(err => setStatus(String(err.message || err), true))
  })
  $('btn-copy').addEventListener('click', () => {
    copyRichText().catch(err => setStatus(String(err.message || err), true))
  })
  $('btn-html').addEventListener('click', () => {
    saveHtml().catch(err => setStatus(String(err.message || err), true))
  })
  $('btn-preview').addEventListener('click', () => {
    openInBrowser().catch(err => setStatus(String(err.message || err), true))
  })
  $('btn-save-config').addEventListener('click', () => {
    saveConfigAsDefault().catch(err => setStatus(String(err.message || err), true))
  })

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      saveMarkdown().catch(err => setStatus(String(err.message || err), true))
    }
  })

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}

/**
 * Shown only when an agent handed the article over. Without it the user has no
 * idea the page is live-editable or that saving is what feeds back to the agent.
 */
function maybeShowAgentBanner() {
  const params = new URLSearchParams(location.search)
  if (!params.has('from'))
    return
  const banner = $('agent-banner')
  banner.hidden = false
  $('banner-close').addEventListener('click', () => {
    banner.hidden = true
  })
}

async function main() {
  bindConfig()
  bindToolbar()
  bindGlobal()
  initSync()
  maybeShowAgentBanner()

  try {
    await loadConfig()
  }
  catch (err) {
    setStatus(`配置加载失败：${err.message}`, true)
  }

  const target = new URLSearchParams(location.search).get('path')
  if (target) {
    try {
      await openByPath(target)
      return
    }
    catch (err) {
      setStatus(String(err.message || err), true)
    }
  }

  // Nothing to open: drop in a short sample so the preview isn't empty.
  els.editor.value = [
    '# 标题',
    '',
    '正文段落，**加粗**、*斜体*、`行内代码`。',
    '',
    '> 引用块',
    '',
    '- 列表项一',
    '- 列表项二',
    '',
    '```js',
    'console.log("hello")',
    '```',
    '',
  ].join('\n')
  await refreshPreview()
}

main()
