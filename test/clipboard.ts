import { renderWechatHtml } from '../src/render'
import { copyHtmlToClipboard } from '../src/clipboard'

const md = `# 剪贴板测试

这是**加粗**文本和 \`代码\`。

> 引用块验证背景色

\`\`\`js
console.log('hi')
\`\`\`
`

const { html } = await renderWechatHtml({ markdown: md, theme: 'grace' })
console.log('html bytes:', Buffer.byteLength(html, 'utf-8'))

await copyHtmlToClipboard(html)

const { execFileSync } = await import('node:child_process')
const out = execFileSync('osascript', ['-e', 'clipboard info']).toString()
console.log('clipboard info:', out.trim())
