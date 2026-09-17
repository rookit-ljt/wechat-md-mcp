import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Format settings saved from the visual editor, so the brand look is dialled in
 * once and then reused everywhere — by the editor, the HTTP API, and the MCP
 * tools. Explicit arguments always win over what's stored here.
 */
export interface EditorState {
  theme: string
  primaryColor: string
  fontFamily: string
  fontSize: string
  lineHeight: string
  isMacCodeBlock: boolean
  isShowLineNumber: boolean
  citeStatus: boolean
  countStatus: boolean
  isUseIndent: boolean
  isUseJustify: boolean
  codeBlockTheme: string
  customCSS: string
}

export const STATE_DEFAULTS: EditorState = {
  theme: 'default',
  primaryColor: '#0F4C81',
  fontFamily: '',
  fontSize: '16px',
  lineHeight: '1.75',
  isMacCodeBlock: false,
  isShowLineNumber: false,
  citeStatus: false,
  countStatus: false,
  isUseIndent: false,
  isUseJustify: false,
  codeBlockTheme: '',
  customCSS: '',
}

const STATE_FILE = process.env.MD_SERVICE_STATE_FILE
  ? path.resolve(process.env.MD_SERVICE_STATE_FILE)
  : path.resolve(import.meta.dirname, '../.editor-state.json')

export function stateFilePath(): string {
  return STATE_FILE
}

export async function readState(): Promise<EditorState> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    const saved = JSON.parse(raw)
    // Only accept known keys with matching types — a stale or hand-edited file
    // shouldn't be able to inject arbitrary render options.
    const merged: any = { ...STATE_DEFAULTS }
    for (const key of Object.keys(STATE_DEFAULTS) as (keyof EditorState)[]) {
      const v = saved?.[key]
      if (v !== undefined && typeof v === typeof STATE_DEFAULTS[key])
        merged[key] = v
    }
    return merged as EditorState
  }
  catch {
    return { ...STATE_DEFAULTS }
  }
}

export async function writeState(patch: Partial<EditorState>): Promise<EditorState> {
  const current = await readState()
  const next: any = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && k in STATE_DEFAULTS)
      next[k] = v
  }
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  return next as EditorState
}

/**
 * Blanks out values the renderer should decide for itself. The editor exposes
 * an empty string for "use the built-in default", which must not be forwarded
 * as an empty value.
 */
export function omitBlanks(state: EditorState): Partial<EditorState> {
  const out: any = {}
  for (const [k, v] of Object.entries(state)) {
    if (v !== '')
      out[k] = v
  }
  return out
}
