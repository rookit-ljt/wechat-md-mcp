import fs from 'node:fs'
import path from 'node:path'
import juice from 'juice'
import { initRenderer } from '@md/core/renderer'
import { postProcessHtml, renderMarkdown } from '@md/core/utils'
import { processCSS } from '@md/core/theme/cssProcessor'
import { generateCSSVariables, generateHeadingStyles } from '@md/core/theme/cssVariables'
import { normalizeForWechat, shadcnVars } from './cssNormalize.ts'

const THEME_DIR = path.resolve(import.meta.dirname, '../vendor/doocs-md/shared/src/configs/theme-css')

export const CODE_BLOCK_PREFIX = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/'

export const THEMES = [
  { value: 'default', label: '经典' },
  { value: 'grace', label: '优雅' },
  { value: 'simple', label: '简洁' },
]

export const DEFAULT_FONT_FAMILY = `-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`

export const DEFAULT_OPTIONS = {
  theme: 'default',
  primaryColor: '#0F4C81',
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: '16px',
  lineHeight: '1.75',
  blockSpacing: '1',
  legend: 'alt',
  codeBlockTheme: `${CODE_BLOCK_PREFIX}github.min.css`,
  isMacCodeBlock: false,
  isShowLineNumber: false,
  citeStatus: false,
  countStatus: false,
  themeMode: 'light',
  isUseIndent: false,
  isUseJustify: false,
}

function loadCSSFile(filename: string): string {
  return fs.readFileSync(path.join(THEME_DIR, filename), 'utf-8')
}

const baseCSS = loadCSSFile('base.css')
const themeMap: Record<string, string> = {
  default: loadCSSFile('default.css'),
  grace: loadCSSFile('grace.css'),
  simple: loadCSSFile('simple.css'),
}

const hljsCache = new Map<string, string>()

async function fetchCodeBlockCSS(url: string): Promise<string> {
  const cached = hljsCache.get(url)
  if (cached)
    return cached
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok)
    throw new Error(`Failed to fetch code block theme CSS (${res.status}): ${url}`)
  const css = await res.text()
  hljsCache.set(url, css)
  return css
}

function escapeStyleContent(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style')
}

export interface RenderInput {
  markdown: string
  theme?: string
  primaryColor?: string
  fontFamily?: string
  fontSize?: string
  lineHeight?: string
  blockSpacing?: string
  linkColor?: string
  blockquoteBackground?: string
  legend?: string
  isMacCodeBlock?: boolean
  isShowLineNumber?: boolean
  citeStatus?: boolean
  countStatus?: boolean
  themeMode?: string
  isUseIndent?: boolean
  isUseJustify?: boolean
  codeBlockTheme?: string
  customCSS?: string
}

/**
 * Runs the full doocs/md pipeline and returns the separated CSS and body HTML.
 */
export async function renderArticle(input: RenderInput) {
  const o: Record<string, any> = { ...DEFAULT_OPTIONS }
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined)
      o[k] = v
  }

  const renderer = initRenderer({
    isMacCodeBlock: !!o.isMacCodeBlock,
    isShowLineNumber: !!o.isShowLineNumber,
    citeStatus: !!o.citeStatus,
    countStatus: !!o.countStatus,
    themeMode: o.themeMode,
    legend: o.legend,
  })

  const { html: baseHtml, readingTime } = renderMarkdown(input.markdown, renderer)
  const bodyHtml = postProcessHtml(baseHtml, readingTime, renderer)
  const { yamlData } = renderer.parseFrontMatterAndContent(input.markdown)

  const cssConfig = {
    primaryColor: o.primaryColor,
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    lineHeight: o.lineHeight,
    blockSpacing: o.blockSpacing,
    linkColor: o.linkColor,
    blockquoteBackground: o.blockquoteBackground,
    isUseIndent: !!o.isUseIndent,
    isUseJustify: !!o.isUseJustify,
    headingStyles: undefined,
  }

  const hljsCSS = o.codeBlockTheme ? await fetchCodeBlockCSS(o.codeBlockTheme) : ''
  const customCSS = escapeStyleContent((o.customCSS || '').trim())

  // Order matters: shadcn vars before the themes that consume them,
  // heading styles and theme CSS after so they win specificity ties.
  let mergedCSS = [
    shadcnVars(String(o.themeMode || 'light')),
    generateCSSVariables(cssConfig),
    baseCSS,
    themeMap[o.theme] || themeMap.default,
    generateHeadingStyles(cssConfig),
    hljsCSS,
    customCSS,
  ].filter(Boolean).join('\n\n')

  mergedCSS = normalizeForWechat(processCSS(mergedCSS))

  return {
    css: mergedCSS,
    bodyHtml,
    frontMatter: yamlData,
    readingTime: {
      words: readingTime.words,
      minutes: readingTime.minutes,
    },
  }
}

export function toStyledHtml(css: string, bodyHtml: string): string {
  return `<style>\n${css}\n</style>\n${bodyHtml}`
}

/**
 * Inlines every rule so the markup survives being pasted into the WeChat editor.
 * WeChat strips <style> blocks and most class references.
 */
export function inlineStyles(html: string): string {
  return juice(html, {
    applyStyleTags: true,
    removeStyleTags: true,
    preserveMediaQueries: false,
    preserveFontFaces: true,
    insertPreservedExtraCss: false,
    preserveImportant: true,
    xmlMode: false,
  })
}

export async function renderWechatHtml(input: RenderInput & { inline?: boolean }) {
  const { css, bodyHtml, frontMatter, readingTime } = await renderArticle(input)
  const styled = toStyledHtml(css, bodyHtml)
  const html = input.inline === false ? styled : inlineStyles(styled)
  return { html, frontMatter, readingTime }
}
