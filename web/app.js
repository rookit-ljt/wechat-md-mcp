'use strict'

const $ = id => document.getElementById(id)

const els = {
  editor: $('editor'),
  preview: $('preview'),
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
