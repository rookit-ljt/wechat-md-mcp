---
name: wechat-md
description: |
  Render Markdown into WeChat Official Account (微信公众号) ready HTML and put it on the clipboard for pasting. Use when the user asks to 排版 / 排版成公众号 / 转成公众号格式 / 渲染这篇文章 / 复制到公众号 / 生成公众号 HTML, or hands over a .md file that is destined for WeChat.
  Covers picking up the saved brand-style config, calling the MCP tools (or the local HTTP fallback), and the WeChat constraints that silently break output — https-only images, mandatory CSS inlining, macOS-only clipboard.
agent_created: true
---

# Markdown → 微信公众号排版

把 Markdown 渲染成可直接粘贴进公众号编辑器的富文本。渲染内核是 doocs/md，外面只包了一层服务和工具。

## 能力边界

这个 skill 只管**渲染和复制**。文章怎么写、截图怎么归档都不在范围内。

## 先判断走哪条路

**有 MCP 工具 `render_markdown`** → 直接用，这是唯一能直接写进剪贴板的路径。

**没有 MCP**（未连接、未信任、或在别的 agent 里没配） → 走 HTTP 兜底，但要清楚代价：拿不到剪贴板，最后一步要人工复制。

### 通过 MCP

```
render_markdown  { path 或 markdown, ...格式参数 }
copy_to_clipboard { html }     ← macOS，写 public.html flavor
```

工具清单：`render_markdown` / `list_themes` / `save_html` / `preview_html` / `copy_to_clipboard` / `open_editor`。

`open_editor` 拉起本地可视化编辑器（左 Markdown / 中 390px 预览 / 右格式面板），传 `path` 直接打开某篇 `.md`，传 `markdown` 则先落盘再打开。**渲染完默认走这个**，详见「渲染完把编辑器交给用户」。格式参数拿不准时用它让用户自己调，别自己猜。

### 通过 HTTP 兜底

在仓库根目录起服务（后台运行）：

```
npm start                      # 默认 127.0.0.1:8788，浏览器打开这个地址就是可视化编辑器
```

然后：

```
curl -s -X POST http://127.0.0.1:8788/render \
  -H 'Content-Type: application/json' \
  -d '{"path":"/abs/path/to/article.md","theme":"default"}' | jq -r .html > /tmp/out.html

open /tmp/out.html
```

浏览器里 Cmd+A、Cmd+C 复制富文本，再进公众号后台 Cmd+V。**这步必须人工**——没有 MCP 就没有 osascript 那条路。

在 WorkBuddy 沙箱里手动跑命令要加前缀，否则 tsx 的 ESM loader 会被注入的 FS 钩子搞坏：

```
env -u NODE_OPTIONS CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npm start
```

## 工作流

1. **定格式参数**。先看 `.editor-state.json`（服务目录下）有没有用户在可视化编辑器里调好并保存的品牌样式——**有就直接沿用**，不要自作主张重设。没有就用下面那套默认值，或问用户。
2. **渲染**。传 `path` 比传 `markdown` 好——长文本走参数容易撞 ARG_MAX。
3. **落盘一份**。渲染完顺手 `save_html`，别只留在对话里。HTML 动辄 8KB 以上，糊在上下文里没意义。
4. **把编辑器交给用户**（见下）。这是标准收尾，不是可选项。
5. **等用户反馈再复制**。用户在编辑器里改完、说"好了"之后，再 `copy_to_clipboard` 并提示去公众号后台 Cmd+V。用户明确说"直接复制"时才跳过第 4 步。
6. **检查图片**。扫一遍渲染结果里的 `<img src>`，只要是本地路径或 `data:` 开头，明确告诉用户**这些图在微信里不会显示**。

## 渲染完把编辑器交给用户

排版不是终点。渲染完用户得**看得见、改得动**，只在对话里丢一段 HTML 等于没交付。

**第一步，把内容递给编辑器**（MCP）：

```
open_editor { path: "/abs/article.md" }        # 文件在磁盘上，首选，用户改完能直接存回去
open_editor { markdown, name }                 # 内容在对话里，会先落到 outputs/<name>.md
open_editor { path, open: false }              # 只取 URL，不弹系统浏览器
```

返回 `{ url, path, port }`——`url` 就是带着这篇文章的编辑器地址。

**第二步，决定在哪打开**：

| 客户端 | 做法 |
| --- | --- |
| 有侧边/内嵌预览面板的（WorkBuddy 等） | 用你的网页展示能力（WorkBuddy 是 `present_files`）打开 `url`——页面嵌在对话右侧，用户不用切窗口。**优先这条** |
| Claude Desktop / Codex / Cursor | `open: true`（默认），系统浏览器打开 |
| 没有 MCP | 走下面 HTTP 兜底 |

**第三步，拿回改动**。用户在编辑器里改完点「保存」，内容写回 `path` 指向的 `.md`。之后你要重新排版就读这个文件——别用对话里那份旧文本。

HTTP 兜底（没 MCP 时同样能开编辑器）：

```
curl -s -X POST http://127.0.0.1:8788/load \
  -H 'Content-Type: application/json' \
  -d '{"path":"/abs/article.md"}'            # 或用 {"markdown":"...","name":"article"}
```

返回的 `url` 字段直接打开即可；服务没起就先 `npm start`。端口可能因为占用往后挪，以 `/health` 或 `/load` 返回的 `port` 为准，别硬编码 8788。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `theme` | `default` | 三套：`default` 经典 / `grace` 优雅 / `simple` 简洁 |
| `primaryColor` | `#0F4C81` | 主色，hex |
| `fontSize` | `16px` | 正文字号 |
| `lineHeight` | `1.75` | 行高 |
| `isMacCodeBlock` | `false` | 代码块加 macOS 风格标题栏 |
| `isShowLineNumber` | `false` | 代码块显示行号 |
| `isUseIndent` | `false` | 段落首行缩进 |
| `isUseJustify` | `false` | 两端对齐 |
| `citeStatus` | `false` | 链接转成脚注式引用 |
| `countStatus` | `false` | 开头加字数/阅读时长 |
| `customCSS` | — | 追加在最后的自定义 CSS，优先级最高 |
| `inline` | `true` | **别关**，见下 |

## 硬约束

这些不是建议，违反了会静默出错：

- **图片必须 https。** 微信只接受 https 外链。本地路径和 `data:` URI 在公众号里都不显示。本地素材要先传图床。
- **`inline` 保持 true。** 微信编辑器会剥掉 `<style>` 块和大部分 class，只有把样式全部内联成 style 属性才能活下来。关掉就是白板无样式。
- **`copy_to_clipboard` 仅 macOS。** 它走 osascript 写 `public.html` flavor，别的系统会直接报错。非 macOS 用 `save_html` / `preview_html`。
- **Node ≥ 20。**

## 排错

| 现象 | 原因 |
| --- | --- |
| 工具列表里没有 `render_markdown` | MCP 没连上。WorkBuddy 要去「连接器管理」点信任；Claude Desktop 要完全退出重开 |
| 粘贴进微信后没样式 | `inline` 被关了，或宿主在粘贴时做了净化 |
| 代码块没高亮 | 首次渲染要去 CDN 拉 highlight.js 主题 CSS，断网会抛错 |
| 命令报 ESM loader 相关错 | 沙箱注入了 FS 钩子，加 `env -u NODE_OPTIONS CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0` |
