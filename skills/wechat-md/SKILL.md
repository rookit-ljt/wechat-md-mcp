---
name: wechat-md
description: |
  Render Markdown into WeChat Official Account (微信公众号) ready HTML and put it on the clipboard for pasting. Use when the user asks to 排版 / 排版成公众号 / 转成公众号格式 / 渲染这篇文章 / 复制到公众号 / 生成公众号 HTML / 侧边栏打开编辑器 / 侧边栏打开编辑器给我看一下 / 打开编辑器看一下 / 侧栏预览 / 侧栏排版, or hands over a .md file that is destined for WeChat.
  Covers picking up the saved brand-style config, calling the MCP tools (or the local HTTP fallback), and the WeChat constraints that silently break output — https-only images, mandatory CSS inlining, macOS-only clipboard.
agent_created: true
---

# Markdown → 微信公众号排版

把 Markdown 渲染成可直接粘贴进公众号编辑器的富文本。渲染内核是 doocs/md，外面只包了一层服务和工具。

## 能力边界

这个 skill 只管**渲染和复制**。文章怎么写、截图怎么归档都不在范围内。

## 先判断走哪条路

**有 MCP 工具 `render_markdown`** → 直接用，工具名即接口名，最省事。

**没有 MCP**（未连接、未信任、或在别的 agent 里没配） → 走 HTTP 兜底。**功能没有缺失**：本地服务的路由和 MCP 工具是一一对应的，`/clipboard` 同样能写剪贴板（macOS），不需要人工 Cmd+C。

两条路都要做的收尾是同一个：**把编辑器交给用户（优先在侧边栏唤起）**，详见下文。

### 通过 MCP

```
render_markdown   { path 或 markdown, ...格式参数 }
open_editor       { path, open: false }  ← 优先侧栏唤起，拿回 url 交给侧边栏
copy_to_clipboard { html }               ← macOS，写 public.html flavor
```

工具清单：`render_markdown` / `list_themes` / `save_html` / `preview_html` / `copy_to_clipboard` / `open_editor`。

`open_editor` 拉起本地可视化编辑器（左 Markdown / 中 390px 移动端预览 / 右格式面板），传 `path` 直接打开某篇 `.md`，传 `markdown` 则先落盘再打开。**渲染完默认走这个**，详见「渲染完把编辑器交给用户」。格式参数拿不准时用它让用户自己调，别自己猜。

### 通过 HTTP 兜底

服务通常已经在跑，先探一下再决定要不要起：

```bash
cat .service-port.json                     # {"port":8788,"host":"127.0.0.1","pid":...}
curl -s http://127.0.0.1:8788/health        # 通就不用重启，返回 {"ok":true,"port":8788,...}
```

没起就在仓库根目录后台启动：

```bash
npm start                      # 默认 127.0.0.1:8788，浏览器打开这个地址就是可视化编辑器
```

路由与 MCP 工具一一对应（`src/server.ts`）：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/render` | POST | 渲染，返回 `{ html, frontMatter, readingTime }` |
| `/clipboard` | POST | **写剪贴板**（macOS，osascript） |
| `/save` | POST | 落盘一份 HTML |
| `/preview` | POST | 临时文件 + 系统浏览器打开 |
| `/load` | POST | 把 `.md` 递给可视化编辑器，返回 `url` |
| `/themes` | GET | 主题列表 |
| `/config` | GET/POST | 读写 `.editor-state.json` 品牌样式 |

渲染并复制：

```bash
curl -s -X POST http://127.0.0.1:8788/render \
  -H 'Content-Type: application/json' \
  -d '{"path":"/abs/path/to/article.md","theme":"default"}' \
  > /tmp/render.json

# 抽出 html 再 POST 回 /clipboard
python3 -c "import json;print(json.dumps({'html':json.load(open('/tmp/render.json'))['html']}))" > /tmp/clip.json
curl -s -X POST http://127.0.0.1:8788/clipboard \
  -H 'Content-Type: application/json' --data-binary @/tmp/clip.json
# → {"copied":16664}
```

**让剪贴板同时带 HTML 和纯文本两种 flavor。** 只写 HTML flavor 时 `osascript -e 'the clipboard as text'` 返回空，用户若粘进纯文本框会得到空白。用一条 osascript 同时写两种，粘贴兼容性最好：

```bash
osascript \
  -e 'set hData to (read (POSIX file "/tmp/render.html") as «class HTML»)' \
  -e 'set tData to (read (POSIX file "/tmp/render.txt") as «class utf8»)' \
  -e 'set the clipboard to {«class HTML»:hData, string:tData}'

osascript -e 'clipboard info'     # 确认 «class HTML» 与 Unicode text 都在
```

注：纯文本版从渲染结果里剥标签即可，图片处替换成 `[图片：alt]` 占位，方便用户知道该在哪插图。

**⚠️ 剪贴板随时会被顶掉，复制要放在本轮最后一个动作。**

在 WorkBuddy 里，**用户消息只要带了 `@文件` 引用，应用就会把那个引用（带 `resource_link` 元数据的 HTML flavor）写进系统剪贴板**——正好覆盖掉 agent 刚复制好的文章。实测规律：agent 写完剪贴板后，用户在下一轮发一条带 `@` 的消息，剪贴板就变成那段引用文本（典型特征：`«class HTML»` 只有 1~2KB，纯文本是一句文件路径）。

因此：

- 复制动作排在本轮最后，**别在这之后再跑可能碰剪贴板的命令**。
- **已实测：`present_files` 本身不动剪贴板**（调用前后 flavor 与体积不变），所以"先复制、再 present_files"的顺序是安全的。覆盖来自别处，不必因此放弃展示产物。
- 复制完立即 `clipboard info` 校验，`«class HTML»` 应在 20KB 量级而不是 1~2KB。
- 交付话术里明确提示用户**当场粘贴**，别隔一轮再粘。
- 用户说"没复制上 / 剪贴板是空的 / 粘出来是文件路径"时，先 `clipboard info` 看体量判断是不是被顶掉了，然后重跑 `/render` + `/clipboard` 即可，无需重新排版。
- 若体积对不上但内容仍是正文（解码 HTML flavor 能看到 `<section class="container"`），说明只是被重编码、没丢内容；稳妥起见直接重写一次即可。

在 WorkBuddy 沙箱里手动跑命令要加前缀，否则 tsx 的 ESM loader 会被注入的 FS 钩子搞坏：

```bash
env -u NODE_OPTIONS CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npm start
```

---

## 指令专章：「侧边栏打开编辑器给我看一下」

当用户明确说**「侧边栏打开编辑器给我看一下」**、**「在侧栏打开编辑器」**、**「侧边栏预览」**或触发了标准排版流程时，Agent **必须把唤起侧边栏作为最高优先级的交互交付动作**：

### 1. 触发关键词
- `侧边栏打开编辑器给我看一下`
- `在侧边栏打开编辑器`
- `侧栏打开编辑器`
- `打开编辑器看一下`
- `侧边栏预览`
- `排版并在侧边栏查看`

### 2. 标准执行规范（严禁只丢一个死链接）

有两种等价且可靠的调用途径：

**途径 A：使用固定脚本（最稳妥，自动后台拉起与防崩溃）**：
```bash
./scripts/open-sidebar.sh "/path/to/article.md" --url-only
```
- 该脚本全自动处理：清洗 `NODE_OPTIONS` 防沙箱崩溃、检测 Node >= 20、后台自启服务（如未运行）、探活端口、调用 `/load` 载入文章，并输出干净的编辑器 URL。
- Agent 获取该 URL 后，在 WorkBuddy 等客户端中直接调用 `present_files` 打开。

**途径 B：使用 MCP 工具**：
1. **准备编辑器 URL**：
   - 优先通过 `path`（文件在本地磁盘）调用 `open_editor { path, open: false }` 或 `POST /load`。
   - 若内容只在对话中，先落盘至 `outputs/<name>.md` 再传 `path`。
   - **务必设置 `open: false`**，避免未经同意弹出外部独立浏览器，破坏侧边栏内嵌一体化体验。
   - 获取返回的 `url`（形如 `http://127.0.0.1:<port>/?path=<urlencoded>&from=agent`）。

2. **即刻在侧边栏唤起页面**：
   - **WorkBuddy 等具备内嵌侧边栏能力的客户端**：
     - **必须立即调用客户端的侧边展示工具（在 WorkBuddy 中为 `present_files`，传入编辑器 `url`）**，直接将编辑器渲染进对话右侧的侧边栏！
     - **严禁**只在对话文本里打出链接让用户手动点击，必须主动弹出侧边栏。
   - **防空白兜底**：内嵌面板若偶发未渲染 `127.0.0.1` 页面，立即补充调用系统指令 `open "<url>"` 保证用户绝对能看到。
   - **Claude Desktop / Codex / 终端等无内嵌侧栏的客户端**：
     - 直接运行 `./scripts/open-sidebar.sh "/path/to/article.md"` 或调用 `open_editor { path, open: true }`，在系统默认浏览器中即刻打开。

3. **标准交付话术**：
   - 唤起侧边栏后，向用户说明：
     > “已为您在**右侧侧边栏打开可视化编辑器**（含 390px 移动端真实预览）。  
     > 您可直接在侧栏查看效果、微调正文或调节右侧格式面板。修改完成后按 `Cmd+S` 保存。  
     > 确认无误后在对话中告诉我（或直接点击编辑器顶部的「复制富文本」），我将为您写入系统剪贴板，即可直接粘进公众号后台。”

---

## 完整工作流

1. **定格式参数**。先看 `.editor-state.json`（服务目录下）有没有用户在可视化编辑器里调好并保存的品牌样式——**有就直接沿用**，不要自作主张重设。没有就用下面那套默认值，或问用户。
2. **渲染**。传 `path` 比传 `markdown` 好——长文本走参数容易撞 ARG_MAX。
3. **落盘一份**。渲染完顺手 `save_html`，别只留在对话里。HTML 动辄 8KB 以上，糊在上下文里没意义。

   **落盘的那份要包成完整 HTML 文档，剪贴板的那份要保持裸 fragment——两者不是同一个东西，别混用：**

   | 用途 | 形态 | 原因 |
   | --- | --- | --- |
   | 剪贴板 / 粘贴进微信 | 裸 `<section class="container">…</section>` | 微信只认片段。带 `<!DOCTYPE>`/`<head>` 的一整份文档粘过去会把 head、`<style>` 一起带进去 |
   | 落盘存档 / 产物面板预览 / 双击打开 | `<!DOCTYPE html>` + `<html><head>`(charset、viewport) + `<body>` 完整文档 | 裸 fragment 没有文档结构，产物面板生成缩略图或独立预览页时会拿不到合法文档，表现就是**面板里什么都不出现**；浏览器直接打开也容易是空白 |

   落盘版外面套一层页面外壳（居中白卡片 + 390px 宽度模拟）会更像公众号，也方便自查：

   ```python
   doc = f'''<!DOCTYPE html>
   <html lang="zh-CN"><head><meta charset="UTF-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0">
   <title>…</title><style>/* 页面外壳样式 */</style></head>
   <body><div class="page">{fragment}</div></body></html>'''
   ```

   验证落盘版非空：`--headless --screenshot` 跑一张，别只看文件大小。

4. **把编辑器交给用户（侧边栏即时唤起）**。按上方「指令专章」规范，调用 `open_editor { path, open: false }`，并通过 `present_files` 推送到右侧侧边栏。
5. **复制到剪贴板**。排在本轮最后，写完立即校验 flavor（见上文「剪贴板随时会被顶掉」）。默认等用户在侧边栏微调完毕、说"好了"之后再复制；用户明确说"直接复制"就直接写，不必先开编辑器。
6. **检查图片**。扫一遍渲染结果里的 `<img src>`，只要是本地路径或 `data:` 开头，明确告诉用户**这些图在微信里不会显示**。

---

## 渲染完把编辑器交给用户

排版不是终点。渲染完用户得**看得见、改得动**，只在对话里丢一段 HTML 等于没交付。

**第一步，把内容递给编辑器**（MCP）：

```
open_editor { path: "/abs/article.md" }        # 文件在磁盘上，首选，用户改完能直接存回去
open_editor { markdown, name }                 # 内容在对话里，会先落到 outputs/<name>.md
open_editor { path, open: false }              # 只取 URL，推送到侧边栏
```

返回 `{ url, path, port }`——`url` 就是带着这篇文章的编辑器地址。

**第二步，决定在哪打开**：

| 客户端 | 做法 |
| --- | --- |
| 有侧边/内嵌预览面板的（WorkBuddy 等） | 用你的网页展示能力（WorkBuddy 是 `present_files`）打开 `url`——页面嵌在对话右侧，用户不用切窗口。**优先这条** |
| Claude Desktop / Codex / Cursor | `open: true`（默认），系统浏览器打开 |
| 没有 MCP | 走下面 HTTP 兜底 |

**注意：内嵌预览面板可能不显示 `127.0.0.1` 页面。** `present_files` 会返回成功，但用户那头可能是空的（面板没渲染、或被折叠了）。用户反馈"没打开编辑器"时不要重复调用 `present_files`，直接补一条 `open <url>` 用系统默认浏览器打开——这才是用户能真正看到、操作的东西：

```bash
open "http://127.0.0.1:8788/?path=<urlencoded-path>&from=agent"
```

想确认编辑器到底有没有正常载入，用无头 Chrome 截图自查（比问用户快）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --no-sandbox --user-data-dir=/tmp/ed-profile \
  --virtual-time-budget=6000 --window-size=1400,1500 \
  --screenshot=/tmp/editor-check.png "<url>"
```

编辑器 UI 的三个要点，用户第一次见到时需要被告知：

- 顶部右侧有 **「复制富文本」** 按钮——用户在编辑器里调完格式可直接复制，不必回到对话里让 agent 重跑 `/clipboard`。
- **「保存 HTML」** 落盘的是渲染后的复制用 HTML。
- 改完 Markdown 要点 **「保存」** 才会写回 `path` 指向的 `.md`；agent 之后要重新排版必须读这个文件，而不是对话里那份旧文本。

预览面板显示的「本地图内嵌 N 张（预览用，微信不支持 data URI）」是编辑器为方便预览临时内联的，**不代表粘贴进微信能显示**——微信仍只认 https 外链，本地图必须手动上传。

**第三步，拿回改动**。用户在编辑器里改完点「保存」，内容写回 `path` 指向的 `.md`。之后你要重新排版就读这个文件——别用对话里那份旧文本。

HTTP 兜底（没 MCP 时同样能开编辑器）：

```bash
curl -s -X POST http://127.0.0.1:8788/load \
  -H 'Content-Type: application/json' \
  -d '{"path":"/abs/article.md"}'            # 或用 {"markdown":"...","name":"article"}
```

返回的 `url` 字段直接打开即可；服务没起就先 `npm start`。端口可能因为占用往后挪，以 `/health` 或 `/load` 返回的 `port` 为准，别硬编码 8788。

---

## 渲染参数速查

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

---

## 硬约束

这些不是建议，违反了会静默出错：

- **图片必须 https。** 微信只接受 https 外链。本地路径和 `data:` URI 在公众号里都不显示。本地素材要先传图床。
- **`inline` 保持 true。** 微信编辑器会剥掉 `<style>` 块和大部分 class，只有把样式全部内联成 style 属性才能活下来。关掉就是白板无样式。
- **写剪贴板仅 macOS。** `copy_to_clipboard`（MCP）和 `/clipboard`（HTTP）都走 osascript，别的系统会直接报错。非 macOS 用 `save_html` / `preview_html`。
- **Node ≥ 20。**

---

## 排错

| 现象 | 原因与对策 |
| --- | --- |
| `render_markdown` 不在工具列表里 | MCP 没连上。**不必卡住**——走 HTTP 兜底，功能等价。WorkBuddy 要去「连接器管理」点信任；Claude Desktop 要完全退出重开 |
| 剪贴板粘进纯文本框是空白 | 只写了 HTML flavor。用 `{«class HTML»:hData, string:tData}` 同时写两种，见上文 |
| 用户说"没打开编辑器" | 内嵌预览面板没渲染 `127.0.0.1` 页面。补 `open <url>` 用系统浏览器打开，别重复调 `present_files` |
| 用户说"产物面板里没东西" | 落盘的那份是裸 fragment、不是完整 HTML 文档。按工作流第 3 步包成完整文档再 `present_files`；改完用 `--headless --screenshot` 确认非空白 |
| `read ... as «class HTML»` 报 -1700 不能转换 | 文件路径不存在（osascript 只能读真实存在的文件）。先落盘 HTML 再读 |
| 粘贴进微信后没样式 | `inline` 被关了，或宿主在粘贴时做了净化 |
| 代码块没高亮 | 首次渲染要去 CDN 拉 highlight.js 主题 CSS，断网会抛错 |
| 命令报 ESM loader 相关错 | 沙箱注入了 FS 钩子，加 `env -u NODE_OPTIONS CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0` |
