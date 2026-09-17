import { renderWechatHtml } from '../src/render'

const md = `\`\`\`js
const greet = (name) => {
  console.log('hi ' + name)
}
\`\`\`

| 工具 | 地址 |
| --- | --- |
| doocs/md | https://md.doocs.org/ |
`

const r = await renderWechatHtml({ markdown: md })

console.log('html length:', r.html.length)
console.log('has <table>:', r.html.includes('<table'))
console.log('hljs spans:', (r.html.match(/<span /g) || []).length)
console.log('---- code block ----')
const code = r.html.match(/<pre[\s\S]{0,900}/)
console.log(code ? code[0] : '(未找到 pre)')
