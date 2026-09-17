# wechat-md-mcp

把 [doocs/md](https://github.com/doocs/md) 的渲染能力搬到命令行和 MCP 里：喂进去 Markdown，吐出来**能直接 Cmd+V 粘进公众号编辑器**的 HTML。

渲染用的是 doocs/md 官方内核（`packages/core`），不是重写。

## 快速开始

```bash
git clone https://github.com/rookit-ljt/wechat-md-mcp.git
cd wechat-md-mcp
npm install          # 需要 Node >= 20

npm start            # HTTP 服务，默认 127.0.0.1:8788
npm run mcp          # MCP 服务（stdio）
npm test             # 冒烟测试
```

仓库自包含，不需要另外把 doocs/md 放到别处。

## 它能干什么

- **Markdown → 公众号 HTML**，样式全部内联。微信公众号会剥掉 `<style>` 标签和大部分 class，所以样式内联不是优化项，是必须的一步。
- 代码块高亮、数学公式、图表、脚注、表格、注音这些能力，都来自 doocs/md，直接可用。
- 两套入口：**HTTP**（任何语言都能调）和 **MCP**（Agent 直接当工具使）。

## HTTP 服务

```bash
npm start                      # 默认 127.0.0.1:8788
MD_SERVICE_PORT=9000 npm start # 改端口
```

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/health` | GET | 健康检查，返回实际端口 |
| `/themes` | GET | 内置主题列表 |
| `/render` | POST | 渲染，参数见下表 |
| `/load` | POST | 把文章交给编辑器，返回可直接打开的编辑器 URL |

`markdown` 和 `path` 给任意一个即可，后者是本地 `.md` 文件路径。

```bash
curl -X POST http://127.0.0.1:8788/render \
  -H 'Content-Type: application/json' \
  -d '{"markdown":"# 标题\n\n正文","theme":"grace","primaryColor":"#07C160"}'
```

返回：

```json
{ "html": "...", "frontMatter": {}, "readingTime": { "words": 9, "minutes": 0.045 } }
```

`POST /load` 是给 agent 用的收尾接口：把文章塞进编辑器，拿回一个能直接打开的 URL。传 `path` 就复用磁盘上的文件（用户在编辑器里保存会写回原文件）；传 `markdown` 则先落到 `outputs/<name>.md`，这样编辑器才有东西可存。

```bash
curl -X POST http://127.0.0.1:8788/load \
  -H 'Content-Type: application/json' \
  -d '{"path":"/abs/article.md"}'
```

```json
{ "path": "/abs/article.md", "url": "http://127.0.0.1:8788/?path=%2Fabs%2Farticle.md&from=agent", "port": 8788 }
```

端口被占用时会往后挪，所以别硬编码 8788——以 `/health` 或 `/load` 返回的 `port` 为准。

## MCP 服务

WorkBuddy、Codex、Cursor、Claude Desktop、Claude Code 都支持，共用同一个入口 `bin/md-mcp`，区别只在配置文件的位置和格式：

| 客户端 | 配置位置 | 格式 |
| --- | --- | --- |
| Codex | `~/.codex/config.toml` | TOML |
| Cursor | `~/.cursor/mcp.json` | JSON |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | JSON |
| Claude Code | `~/.claude.json`，或项目根目录 `.mcp.json`，或 `claude mcp add` | JSON |
| WorkBuddy | `~/.workbuddy/mcp.json` | JSON |

JSON 类（WorkBuddy / Claude）的写法：

```json
{
  "mcpServers": {
    "wechat-md-mcp": {
      "command": "/path/to/wechat-md-mcp/bin/md-mcp"
    }
  }
}
```

Codex 的写法：

```toml
[mcp_servers.wechat-md-mcp]
command = "/path/to/wechat-md-mcp/bin/md-mcp"
args = []
```

完整的分客户端配置、免 shell 启动器的替代写法、以及排错，见 [docs/客户端接入.md](docs/客户端接入.md)。

两点容易漏的：WorkBuddy 要去「连接器管理」页面右上角对新服务点「信任」；Claude Desktop **必须完全退出再重开**才会加载新配置。

提供的 5 个工具：

| 工具 | 作用 |
| --- | --- |
| `render_markdown` | 渲染 Markdown（或本地 `.md` 路径）为公众号 HTML |
| `list_themes` | 列出内置主题 |
| `save_html` | 把 HTML 落盘 |
| `preview_html` | 存到临时文件并用浏览器打开 |
| `copy_to_clipboard` | 写入 macOS 剪贴板，回公众号后台 Cmd+V |
| `open_editor` | 拉起可视化编辑器并用浏览器打开，传 `path` 直接打开某篇 `.md` |

典型流程：`render_markdown` → `copy_to_clipboard` → 公众号后台 Cmd+V。

### 顺手装一下 Skill

MCP 只给 agent 工具，不告诉它什么时候用、按什么顺序用。`skills/wechat-md/SKILL.md` 补这一层，格式是几家 agent 通用的：

```bash
npm run install:skill        # 软链到 Claude / Codex / Cursor / WorkBuddy 的 skills 目录
npm run uninstall:skill      # 移除
```

没装的 agent 会自动跳过。已存在时默认不覆盖，要重建加 `--force`：

```bash
sh scripts/install-skill.sh --force
```

装完之后直接说「把这篇排版成公众号格式」就行，它会自己去读品牌配置、渲染、复制，不用你复述流程。只装 Skill 也能用——里面写了 HTTP 兜底路径。

用软链而不是复制，是为了改仓库里那一份 SKILL.md 就四家同时生效。

## 在 Agent 里怎么用

MCP 和 Skill 都装好之后，不用记工具名，说人话就行：

```
把 ~/文章/xxx.md 排版成公众号格式，复制到剪贴板
```

四家都认。Agent 会按 SKILL.md 里的流程自己走完，不需要你复述步骤：

1. 渲染（优先传文件路径，长文本走参数容易撞 ARG_MAX）
2. `save_html` 落盘一份，不把大段 HTML 糊在对话里
3. **把编辑器交给用户**：`open_editor` 打开带这篇文章的编辑器。有侧边预览面板的客户端（比如 WorkBuddy）会把页面嵌在对话右侧，你就在对话里看着改
4. 你在编辑器里改完点「保存」，回对话说一声，它才 `copy_to_clipboard`，然后告诉你可以去公众号后台 Cmd+V
5. 扫一遍 `<img src>`，发现本地路径会提醒你先传图床

第 3 步不是可选项——排版完不给看，等于没交付。想跳过就直接说「渲染完直接复制」。

想精确控制就直接点名：

```
用 grace 主题渲染这篇，主色 #07C160，代码块加 macOS 标题栏
有哪些主题？
只渲染，别复制
```

### 各家的生效条件

| 客户端 | 装完要做什么 |
| --- | --- |
| **WorkBuddy** | 去「连接器管理」页面右上角对新服务点「信任」 |
| **Claude Desktop** | **完全退出再重开**，只关窗口不算 |
| **Claude Code** | 重开会话，`/mcp` 可查看当前连接状态 |
| **Codex** | 开新会话。GUI 客户端不继承 shell PATH，启动器会自动兜底找 Node |
| **Cursor** | 在 MCP 设置里确认服务已启用 |

### 只装 Skill、没装 MCP

也跑得通，代价是拿不到剪贴板。SKILL.md 里写了 HTTP 兜底：起服务 → 渲染 → 落盘 → 浏览器打开，最后一步 Cmd+A、Cmd+C 由你手动复制。

### 两个都没装

直接调 HTTP 接口就行，见上面「HTTP 服务」一节。任何语言、任何脚本都能调，不依赖 agent。

更多分客户端的细节见 [docs/客户端接入.md](docs/客户端接入.md)。

## 可视化编辑器

起服务后浏览器打开 <http://127.0.0.1:8788/>：

```bash
npm start
```

三栏：左边写 Markdown，中间 390px 手机宽度实时预览，右边调格式。改动 250ms 防抖后自动重渲染。

- **打开 / 保存**：点「打开 .md」填绝对路径，或把文件拖进编辑区（拖拽只能拿到内容，没有路径，保存时会再问一次）。`Cmd/Cmd+S` 保存，每次保存前会把原文件备份成 `.bak`。
- **内联模式开关**：预览默认**不内联**（保留 `<style>`），因为 juice 内联会丢掉伪元素和媒体查询，看版式反而失真。勾上「内联模式」才是真正粘进微信后的样子——粘之前建议切过去确认一次。
- **本地图片**：预览会把 `.md` 所在目录下的本地图转成 data URI 显示出来，否则全是裂图。**这只对预览有效**，微信不吃 data URI，发布前还是要传图床。
- **三个导出按钮**：复制富文本（服务端 osascript 写剪贴板，最可靠）、保存 HTML（浏览器下载）、浏览器预览（系统默认浏览器打开）。

右边调完格式点**「保存为默认」**，配置落到服务目录的 `.editor-state.json`。之后 HTTP 接口和 MCP 工具渲染任何文章都会**默认沿用这份配置**，不用每次传参；显式传的参数仍然优先。

### 由 agent 打开

排版完成后 `open_editor`（或 `POST /load`）会返回一个带 `?path=...&from=agent` 的 URL。页面认这个参数：直接载入那篇文章，顶部显示一条提示条告诉你改完点保存、再回对话说一声。

- **有侧边预览面板的客户端**（WorkBuddy 等）：把 URL 交给内嵌面板，页面开在对话右侧，不用来回切窗口
- **其他客户端**：`open_editor` 默认用系统浏览器打开；传 `open: false` 可以只拿 URL、自己决定怎么展示

窄面板（< 1100px）下三栏会自动改成纵向堆叠并允许滚动，嵌在侧边栏里也不会挤成一团。

不引前端构建工具：页面是原生 HTML/CSS/JS 三个文件，由同一个 Node 进程托管，不加依赖、不需要 build。

## 渲染参数

`render_markdown` 与 `POST /render` 接受同一套参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `markdown` / `path` | 二选一 | Markdown 原文，或本地 `.md` 文件路径 |
| `theme` | `default` | `default` 经典 / `grace` 优雅 / `simple` 简洁 |
| `primaryColor` | `#0F4C81` | 主色，标题、强调、链接都跟它走 |
| `fontFamily` | 系统字体栈 | 默认 PingFang / 微软雅黑 |
| `fontSize` | `16px` | 正文字号 |
| `lineHeight` | `1.75` | 行高 |
| `isMacCodeBlock` | `false` | 代码块 macOS 红黄绿标题栏 |
| `isShowLineNumber` | `false` | 代码块行号 |
| `citeStatus` | `false` | 链接转脚注引用样式 |
| `countStatus` | `false` | 文首显示字数/阅读时长 |
| `isUseIndent` | `false` | 段首缩进两字符 |
| `isUseJustify` | `false` | 两端对齐 |
| `codeBlockTheme` | highlight.js `github` | hljs 主题 CSS URL |
| `customCSS` | — | 追加自定义 CSS，优先级最高 |
| `inline` | `true` | 是否内联全部样式（**粘进公众号时不要关**） |

## 注意事项

**图片必须用 https。** 微信只接受 https 图片，Markdown 里的本地路径粘过去不会显示，需要先传图床。

**粘进公众号前别关 `inline`。** 关掉的话输出是 `<style>` + class 的形式，微信会把它们剥掉，正文只剩纯文本。

**手动跑命令可能需要 `env -u NODE_OPTIONS`。** 部分宿主（如 WorkBuddy）会往 `NODE_OPTIONS` 注入钩子，破坏 tsx 的 ESM loader，表现为启动即崩。`bin/md-mcp` 启动器内部已经处理了，但直接用 `npx tsx` 跑别的命令时要自己加：

```bash
env -u NODE_OPTIONS npx tsx test/smoke.ts
```

**Node 版本要 ≥ 20。** 启动器依次尝试 `$MD_SERVICE_NODE`、PATH、以及几个常见绝对路径。Claude Desktop 和 Codex 这类 GUI 客户端不会继承你 shell 的 PATH，所以这一步做了兜底探测；真找不到时会明确报错提示设 `MD_SERVICE_NODE`。

**`copy_to_clipboard` 只支持 macOS。** 它走 `osascript` 写 `public.html` flavor；其他系统没有 `osascript`，这个工具会直接报错。非 macOS 请用 `save_html` 或 `preview_html` 拿到 HTML 再手动处理。

**主题只有 3 套。** doocs/md 的 shared config 里就这 3 个 CSS。想要别的版式用 `customCSS` 叠加。

**没有草稿箱发布。** 个人订阅号的接口权限通常拿不到，实测剪贴板粘贴更稳。

**编辑器的 `/open` `/save` 能读写本机任意路径。** 这是它存在的前提（否则浏览器打不开本地 `.md`），代价是本机任何进程都能通过这两个接口读写文件。服务只监听 `127.0.0.1`，**不要**把它转发到局域网或公网，也不要改成监听 `0.0.0.0`。保存时会先备份 `.bak`，但仍是一次覆盖写。

**改 `vendor/` 下的代码时注意 import 写法。** 为了精简，vendored 副本删掉了部分文件和入口，裸 `import '@md/shared'` 会失败，请用 `@md/shared/configs`、`@md/shared/types`、`@md/shared/utils` 这类子路径——上游 core 本来就是这么写的。上游版本与更新方式见 [vendor/doocs-md/UPSTREAM.md](vendor/doocs-md/UPSTREAM.md)。

## 项目结构

```
├── vendor/doocs-md/   # 裁剪后的 doocs/md 渲染内核
├── bin/md-mcp         # MCP 启动器
├── run-mcp.mjs        # MCP 入口
├── run-server.mjs     # HTTP 入口
├── polyfill.mjs       # core 会碰到的浏览器 API 补丁
├── src/               # 渲染管线、HTTP 接口、MCP 工具定义
├── web/               # 可视化编辑器（原生三文件，无构建步骤）
├── skills/wechat-md/  # SKILL.md，告诉各 agent 怎么用这套工具
├── scripts/           # skill 的安装/卸载脚本
├── docs/              # 各 MCP 客户端的接入配置
└── test/              # 冒烟测试与预览生成
```

## 常见用法

```bash
npm test                                          # 渲染冒烟 + 代码块/表格
npx tsx test/clipboard.ts                         # 验证剪贴板写入（会覆盖剪贴板）
npx tsx test/build-preview.ts <md> <out> <theme>  # 生成 375px 手机宽度预览页
```

## 许可

本项目 MIT。

`vendor/doocs-md/` 下是 [doocs/md](https://github.com/doocs/md) 的代码（MIT，Copyright (c) Doocs），按原 license 重新分发。
