import { renderWechatHtml } from '../src/render'

const md = `# 标题一

这是**加粗**和 \`行内代码\`，还有一个[链接](https://mp.weixin.qq.com/s/xxxx)。

## 二级标题

- 列表一
- 列表二

> 引用一句话

| 工具 | 地址 |
| --- | --- |
| doocs/md | https://md.doocs.org/ |

\`\`\`js
console.log('hello md-service')
\`\`\`
`

const result = await renderWechatHtml({ markdown: md })

console.log('readingTime:', JSON.stringify(result.readingTime))
console.log('html length:', result.html.length)
console.log('has <style>:', result.html.includes('<style'))

const problems = {
  'var(': (result.html.match(/var\(--/g) || []).length,
  'hsl(': (result.html.match(/hsl\(/g) || []).length,
  'color-mix(': (result.html.match(/color-mix\(/g) || []).length,
  'undefined': (result.html.match(/undefined/g) || []).length,
  'calc(': (result.html.match(/calc\(/g) || []).length,
}
console.log('残留问题:', JSON.stringify(problems))

console.log('---- first 800 chars ----')
console.log(result.html.slice(0, 800))
console.log('---- 引用块样式片段 ----')
const quote = result.html.match(/<blockquote[\s\S]{0,300}/)
console.log(quote ? quote[0] : '(未找到)')
