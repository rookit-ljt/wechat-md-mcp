import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { copyHtmlToClipboard } from './clipboard'
import { renderWechatHtml, THEMES } from './render'
import { omitBlanks, readState, stateFilePath } from './state'

const SERVICE_PORT = Number(process.env.MD_SERVICE_PORT || 8788)
const SERVICE_HOST = process.env.MD_SERVICE_HOST || '127.0.0.1'
const ROOT = path.resolve(import.meta.dirname, '..')

function jsonText(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
}

function textResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }] }
}

const renderInputSchema = z.object({
  markdown: z.string().optional().describe('Markdown source. Either this or `path` is required.'),
  path: z.string().optional().describe('Path to a local .md file. Used when `markdown` is omitted.'),
  theme: z.enum(['default', 'grace', 'simple']).optional().describe('Visual theme: default 经典 / grace 优雅 / simple 简洁.'),
  primaryColor: z.string().optional().describe('Primary accent colour, hex, e.g. #0F4C81.'),
  fontSize: z.string().optional().describe('Base font size, e.g. 16px.'),
  lineHeight: z.string().optional().describe('Body line height, unitless, e.g. 1.75.'),
  isMacCodeBlock: z.boolean().optional().describe('macOS-style code block title bar.'),
  isShowLineNumber: z.boolean().optional().describe('Show line numbers in code blocks.'),
  citeStatus: z.boolean().optional().describe('Render links as footnote-style citations.'),
  countStatus: z.boolean().optional().describe('Prepend a reading-time estimate.'),
  isUseIndent: z.boolean().optional().describe('Indent paragraph first lines.'),
  isUseJustify: z.boolean().optional().describe('Justify paragraph text.'),
  codeBlockTheme: z.string().optional().describe('highlight.js theme URL for code blocks.'),
  customCSS: z.string().optional().describe('Extra CSS appended last (highest priority).'),
  inline: z.boolean().optional().default(true).describe('Inline all CSS so the markup survives pasting into WeChat. Default true.'),
})

const server = new McpServer({
  name: 'wechat-md-mcp',
  version: '0.1.0',
})

server.registerTool(
  'render_markdown',
  {
    description:
      'Render Markdown into WeChat-Official-Account-ready HTML using the doocs/md engine. '
      + 'Supports KaTeX math, Mermaid, PlantUML, footnotes, alerts, ruby text, sliders and TOC. '
      + 'By default the CSS is inlined so the result can be pasted straight into the WeChat editor.',
    inputSchema: renderInputSchema,
  },
  async (args: any) => {
    let markdown = args.markdown
    if (!markdown) {
      if (!args.path)
        return jsonText({ error: { code: 'missing_input', message: 'Provide `markdown` or `path`.' } })
      markdown = await fs.readFile(args.path, 'utf-8')
    }
    // Brand settings saved from the visual editor act as defaults; explicit
    // arguments still win.
    const saved = omitBlanks(await readState())
    const result = await renderWechatHtml({ ...saved, ...args, markdown })
    return jsonText(result)
  },
)

server.registerTool(
  'list_themes',
  {
    description: 'List the built-in doocs/md themes.',
  },
  () => jsonText({ themes: THEMES }),
)

server.registerTool(
  'save_html',
  {
    description: 'Write rendered HTML to a local file and return the absolute path.',
    inputSchema: z.object({
      html: z.string().describe('The HTML to save.'),
      path: z.string().describe('Destination file path (absolute or relative to the workspace).'),
    }),
  },
  async (args: any) => {
    const target = path.resolve(args.path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, args.html, 'utf-8')
    return textResult(`Saved: ${target}`)
  },
)

server.registerTool(
  'preview_html',
  {
    description: 'Save HTML to a temp file and open it in the default browser for a visual check.',
    inputSchema: z.object({
      html: z.string().describe('The HTML to preview.'),
      path: z.string().optional().describe('Optional output path. Defaults to a temp file.'),
    }),
  },
  async (args: any) => {
    const target = args.path
      ? path.resolve(args.path)
      : path.join(os.tmpdir(), `md-preview-${Date.now()}.html`)
    await fs.writeFile(target, args.html, 'utf-8')
    execFile('open', [target])
    return textResult(`Preview opened: ${target}`)
  },
)

server.registerTool(
  'copy_to_clipboard',
  {
    description:
      'Put HTML on the macOS clipboard as rich text (public.html) so it can be pasted into the '
      + 'WeChat editor with Cmd+V, keeping all styling. macOS only.',
    inputSchema: z.object({
      html: z.string().describe('The HTML to copy.'),
    }),
  },
  async (args: any) => {
    await copyHtmlToClipboard(args.html)
    return textResult('HTML copied to clipboard. Switch to the WeChat editor and press Cmd+V.')
  },
)

async function serviceAlive(): Promise<boolean> {
  try {
    const res = await fetch(`http://${SERVICE_HOST}:${SERVICE_PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  }
  catch {
    return false
  }
}

function startService(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tsxBin = path.join(ROOT, 'node_modules', '.bin', 'tsx')
    const useBin = fsSync.existsSync(tsxBin)
    const child = spawn(
      useBin ? tsxBin : process.execPath,
      useBin ? [path.join(ROOT, 'run-server.mjs')] : ['--import', 'tsx', path.join(ROOT, 'run-server.mjs')],
      { cwd: ROOT, detached: true, stdio: 'ignore' },
    )
    child.on('error', reject)
    child.unref()

    // Poll until the HTTP server answers, so the browser never hits a dead port.
    const deadline = Date.now() + 15_000
    const tick = setInterval(async () => {
      if (await serviceAlive()) {
        clearInterval(tick)
        resolve()
      }
      else if (Date.now() > deadline) {
        clearInterval(tick)
        reject(new Error('Editor service did not start within 15s.'))
      }
    }, 400)
  })
}

server.registerTool(
  'open_editor',
  {
    description:
      'Open the local visual editor in the browser: Markdown on the left, a 390px '
      + 'WeChat-width preview in the middle, format controls on the right. Format settings '
      + 'saved there become the default for every later render. Pass `path` to open a .md file.',
    inputSchema: z.object({
      path: z.string().optional().describe('Absolute path to a local .md file to open.'),
    }),
  },
  async (args: any) => {
    if (!await serviceAlive())
      await startService()

    const url = args.path
      ? `http://${SERVICE_HOST}:${SERVICE_PORT}/?path=${encodeURIComponent(path.resolve(args.path))}`
      : `http://${SERVICE_HOST}:${SERVICE_PORT}/`
    execFile('open', [url])
    return textResult(`Editor opened: ${url}\nFormat defaults are stored in ${stateFilePath()}`)
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[wechat-md-mcp] MCP server running on stdio\n')
}

main().catch((err) => {
  process.stderr.write(`[md-service] fatal: ${err}\n`)
  process.exit(1)
})
