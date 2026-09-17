import { spawn } from 'node:child_process'

/**
 * Writes HTML to the macOS clipboard using the `public.html` flavour, so the
 * WeChat editor receives rich content instead of plain text on Cmd+V.
 *
 * The payload is piped through osascript's stdin rather than `-e`: a long
 * article hex-encoded easily exceeds the ARG_MAX limit when passed as argv,
 * and argv failures surface only as a mysterious E2BIG.
 */
export function copyHtmlToClipboard(html: string): Promise<void> {
  const hex = Buffer.from(html, 'utf8').toString('hex')
  const script = `set the clipboard to «data HTML${hex}»`

  return new Promise((resolve, reject) => {
    const child = spawn('osascript', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', chunk => stderr += chunk)

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0)
        resolve()
      else
        reject(new Error(`osascript exited with ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
    })

    child.stdin.on('error', reject)
    child.stdin.end(script)
  })
}
