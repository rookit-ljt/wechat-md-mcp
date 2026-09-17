/**
 * Post-processes theme CSS into a form the WeChat editor accepts.
 *
 * The doocs/md themes were written for a Tailwind/shadcn browser runtime:
 *   - `--foreground`, `--muted-foreground`, `--blockquote-background` come from
 *     apps/web/src/assets/index.css and are otherwise undefined in Node.
 *   - Modern `hsl(0 0% 3.9%)` (space-separated) and `color-mix()` are silently
 *     dropped by the WeChat editor.
 *
 * This module injects the missing variables and rewrites both constructs into
 * plain hex / rgba literals so the styles survive a copy-paste.
 */

const ORIGIN = 0x80
const LIGHT_FALLBACK_COLOR = `#272727`

const SHADCN_LIGHT_VARS = `:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 20%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 20%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 20%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 96.1%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 96.1%;
  --muted-foreground: 0 0% 45.1%;
  --accent: 0 0% 96.1%;
  --accent-foreground: 0 0% 9%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 89.8%;
  --input: 0 0% 89.8%;
  --ring: 0 0% 3.9%;
  --radius: 0.5rem;
  --blockquote-background: #f7f7f7;
}
`

const SHADCN_DARK_VARS = `.dark {
  --background: 0 0% 3.9%;
  --foreground: 0 0% 98%;
  --muted-foreground: 0 0% 63.9%;
  --blockquote-background: #1f1f1f;
  --border: 0 0% 14.9%;
  --radius: 0.5rem;
}
`

/** Shadcn base variables the built-in themes reference but never declare. */
export function shadcnVars(themeMode: string = 'light'): string {
  return [
    SHADCN_LIGHT_VARS,
    themeMode === 'dark' ? SHADCN_DARK_VARS : '',
  ].filter(Boolean).join('\n')
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/** `hsl(210 40% 50%)` / `hsl(210, 40%, 50%)` -> `#5c8ab8` (alpha kept as rgba). */
export function hslToRgb(h: number, s: number, l: number, alpha = 1): string {
  const sn = s / 100
  const ln = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))

  const r = clamp255(f(ORIGIN) * 255)
  const g = clamp255(f(8) * 255)
  const b = clamp255(f(4) * 255)

  if (alpha >= 0.999)
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`

  const roundAlpha = Math.round(alpha * 1000) / 1000
  return `rgba(${r}, ${g}, ${b}, ${roundAlpha})`
}

const NUMBER = String.raw`-?[\d.]+`
const HUE = String.raw`-?[\d.]+(?:deg)?`
const PCT = String.raw`-?[\d.]+%`
const SEP = String.raw`[\s,]+`
const HSL_RE = new RegExp(
  String.raw`hsl\(\s*(${HUE})${SEP}(${PCT})${SEP}(${PCT})(?:\s*/\s*(${NUMBER}(?:%)?))?\s*\)`,
  'gi',
)

function toAlpha(raw?: string): number {
  if (!raw)
    return 1
  return raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw)
}

/** Rewrites every `hsl()` literal into hex / rgba. */
export function normalizeHsl(css: string): string {
  return css.replace(HSL_RE, (_match, hRaw, sRaw, lRaw, alphaRaw) => {
    const h = Number.parseFloat(hRaw)
    const s = Number.parseFloat(sRaw)
    const l = Number.parseFloat(lRaw)
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l))
      return LIGHT_FALLBACK_COLOR
    return hslToRgb(h, s, l, toAlpha(alphaRaw))
  })
}

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

const HEX_RE = /^#([0-9a-f]{3,8})$/i

/** Understands the small colour vocabulary the themes actually use. */
export function parseColor(input: string): RGBA | undefined {
  const value = input.trim()
  if (!value)
    return undefined

  if (value === 'transparent')
    return { r: 0, g: 0, b: 0, a: 0 }

  const hex = value.match(HEX_RE)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4)
      h = h.split('').map(c => c + c).join('')
    return {
      r: Number.parseInt(h.slice(0, 2), 16),
      g: Number.parseInt(h.slice(2, 4), 16),
      b: Number.parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1,
    }
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+(?:\.\d+)?)\s*[,\s]\s*([\d.]+(?:\.\d+)?)\s*[,\s]\s*([\d.]+(?:\.\d+)?)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/i)
  if (rgb) {
    return {
      r: Number.parseFloat(rgb[1]),
      g: Number.parseFloat(rgb[2]),
      b: Number.parseFloat(rgb[3]),
      a: rgb[4] ? toAlpha(rgb[4]) : 1,
    }
  }

  const named: Record<string, string> = {
    white: '#ffffff',
    black: '#000000',
    currentcolor: LIGHT_FALLBACK_COLOR,
    currentColor: LIGHT_FALLBACK_COLOR,
    inherit: LIGHT_FALLBACK_COLOR,
  }
  if (named[value])
    return parseColor(named[value])

  return undefined
}

function mixColor(a: RGBA, b: RGBA, weightA: number): string {
  const wa = Math.max(0, Math.min(1, weightA))
  const wb = 1 - wa
  const r = clamp255(a.r * wa + b.r * wb)
  const g = clamp255(a.g * wa + b.g * wb)
  const bl = clamp255(a.b * wa + b.b * wb)
  const alpha = Math.round((a.a * wa + b.a * wb) * 1000) / 1000

  if (alpha >= 0.999)
    return `#${[r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('')}`
  return `rgba(${r}, ${g}, ${bl}, ${alpha})`
}

const COLOR_MIX_RE = /color-mix\(\s*in\s+[\w-]+\s*,\s*([\s\S]+?)\s*,\s*([\s\S]+?)\s*\)/gi

/**
 * `color-mix(in srgb, #000 50%, transparent)` -> `rgba(0, 0, 0, 0.5)`.
 * The second operand may itself be another color-mix, so this iterates.
 */
export function normalizeColorMix(css: string): string {
  let result = css
  for (let pass = 0; pass < 5; pass++) {
    const next = result.replace(COLOR_MIX_RE, (_match, firstRaw: string, secondRaw: string) => {
      const firstRatio = firstRaw.match(/(-?[\d.]+)%\s*$/)
      const c1 = parseColor((firstRatio ? firstRaw.slice(0, firstRatio.index) : firstRaw).trim())
      const c2 = parseColor(secondRaw.trim())
      if (!c1 || !c2)
        return LIGHT_FALLBACK_COLOR
      const weight = firstRatio ? Number.parseFloat(firstRatio[1]) / 100 : 0.5
      return mixColor(c1, c2, weight)
    })
    if (next === result)
      break
    result = next
  }
  return result
}

/** Full normalisation pass run after `processCSS`. */
export function normalizeForWechat(css: string): string {
  return normalizeColorMix(normalizeHsl(css))
}
