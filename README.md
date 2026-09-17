# wechat-md-mcp

把 [doocs/md](https://github.com/doocs/md) 的渲染能力搬到命令行和 MCP 里：喂进去 Markdown，吐出来**能直接 Cmd+V 粘进公众号编辑器**的 HTML。

渲染用的是 doocs/md 官方内核（`packages/core`），不是重写。

```bash
npm install
npm start        # HTTP 服务，默认 127.0.0.1:8788
npm run mcp      # MCP 服务（stdio）
npm test
```

## 它能干什么

- **Markdown → 公众号 HTML**，样式全部内联。微信公众号会剥掉 `<style>` 标签和大部分 class，所以样式内联不是优化项，是必须的一步。
- 代码块高亮、数学公式、图表、脚注、表格、注音这些能力，都是 doocs/md 本来就有的。
- 两套入口：**HTTP**（任何语言都能调）和 **MCP**（Agent 直接把它当工具使）。

## 为什么不用官方的 `@md/mcp-server`

doocs/md 官方确实写了 `packages/mcp-server`，但它：

- **没有发布到 npm**，必须拉整个 monorepo 跑源码
- 依赖 pnpm 装几十个 workspace 包，装完好几个 G
- 它的 `apps/api` 是 Cloudflare Workers 的云同步服务，跟本地渲染没关系

这个项目只取 `packages/core` 和 `packages/shared` 两个包，裁剪后 vendor 进仓库（约 500KB），npm 依赖从几十个 workspace 包缩到 11 个。

## 目录结构

```
wechat-md-mcp/
├── vendor/doocs-md/        # 裁剪后的 doocs/md 渲染内核，见 UPSTREAM.md
├── bin/md-mcp              # MCP 启动器
├── run-mcp.mjs             # MCP 入口
├── run-server.mjs          # HTTP 入口
├── polyfill.mjs            # core 会碰到的浏览器 API 补丁
├── src/
│   ├── render.ts           # 渲染管线
│   ├── cssNormalize.ts     # shadcn 变量注入 + 颜色归一化
│   ├── clipboard.ts        # macOS 富文本剪贴板
│   ├── server.ts           # HTTP 接口
│   └── mcp.ts              # MCP 工具定义
├── test/                   # 冒烟测试与预览生成
└── docs/选型记录.md         # 为什么最终选了 doocs/md
```

## HTTP 服务

```bash
npm start                      # 默认 127.0.0.1:8788
MD_SERVICE_PORT=9000 npm start # 改端口
```

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/health` | GET | 健康检查 |
| `/themes` | GET | 内置主题列表 |
| `/render` | POST | 渲染，参数见下表 |

```bash
curl -X POST http://127.0.0.1:8788/render \
  -H 'Content-Type: application/json' \
  -d '{"markdown":"# 标题\n\n正文","theme":"grace","primaryColor":"#07C160"}'
```

## MCP 服务

在 MCP 宿主里这样注册（路径换成你 clone 的位置）：

```json
{
  "mcpServers": {
    "wechat-md-mcp": {
      "command": "/path/to/wechat-md-mcp/bin/md-mcp"
    }
  }
}
```

WorkBuddy 用户还需要去「连接器管理」页面右上角的自定义连接器入口，对新服务点「信任」才会生效。

提供的 5 个工具：

| 工具 | 作用 |
| --- | --- |
| `render_markdown` | 渲染 Markdown（或本地 `.md` 路径）为公众号 HTML |
| `list_themes` | 列出内置主题 |
| `save_html` | 把 HTML 落盘 |
| `preview_html` | 存到临时文件并用浏览器打开 |
| `copy_to_clipboard` | 写入 macOS 剪贴板，回公众号后台 Cmd+V |

### 关于 `bin/md-mcp`

启动器专门做了两件事：

1. **`unset NODE_OPTIONS`**。WorkBuddy 会往里面注入一个 brokered-FS 钩子，这个钩子会破坏 tsx 依赖的 ESM loader，导致启动即崩。清除动作放在启动器内部而不是命令行上，是因为后续可能二次 spawn 子进程，光靠 `env -u` 罩不住。
2. **挑选 Node 二进制**。要求 Node ≥ 20。想精确指定就设环境变量 `MD_SERVICE_NODE`，否则用 PATH 上的 node。

## 渲染参数

`render_markdown` 与 `POST /render` 接受同一套参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
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

## 两个踩过的坑

这两个坑不修，出来的 HTML 在微信里基本是「白板、无样式」，而且很难 debug——本地浏览器预览一切正常，只有粘进公众号才现形。

### 1. shadcn 变量在 Node 侧不存在

`default.css` 和 `grace.css` 大量使用 `var(--foreground)`、`var(--muted-foreground)`、`var(--blockquote-background)`。这些变量定义在 Web 端的 `apps/web/src/assets/index.css`，浏览器里由 Tailwind 注入；Node 里直接渲染时一个都没有，`processCSS` 也无从解析。

`cssNormalize.ts` 的 `shadcnVars()` 补了一套等价的 `:root` 声明，放在主题 CSS 之前参与变量解析。

### 2. 微信不认 `hsl()` 和 `color-mix()`

变量解析完之后剩下的是现代 CSS 写法：

- `hsl(0 0% 3.9%)` — 空格分隔的新语法，微信直接丢弃
- `color-mix(in srgb, #333 50%, transparent)` — 完全不支持

`normalizeForWechat()` 把前者转成 `#rrggbb` / `rgba()`，把后者按 srgb 通道混合算出实际颜色字面量。

**自检方式**：渲染结果里 `var(`、`hsl(`、`color-mix(`、`calc(`、`undefined` 这几个串的计数应该全是 0。`test/smoke.ts` 会打印这个计数。

## 已知边界

- **图片**：微信只吃 https 图片。Markdown 里的本地路径需要先传图床。
- **主题数量**：内置只有 3 套（doocs/md 的 shared config 里就这 3 个 CSS）。想要别的版式用 `customCSS` 叠加。
- **发布草稿箱**：没做。个人订阅号的接口权限通常拿不到，实测走剪贴板粘贴更稳。
- **`copy_to_clipboard` 只支持 macOS**，走 `osascript` 写 `public.html` flavor。

## 测试

```bash
npm test                                          # 渲染冒烟 + 代码块/表格
npx tsx test/clipboard.ts                         # 验证剪贴板写入（会覆盖你的剪贴板）
npx tsx test/build-preview.ts <md> <out> <theme>  # 生成 375px 手机宽度预览页
```

如果宿主往 `NODE_OPTIONS` 里注入过东西，手动跑这几个命令时前面加 `env -u NODE_OPTIONS`。

## 许可

本项目 MIT。

`vendor/doocs-md/` 下是 [doocs/md](https://github.com/doocs/md) 的代码（MIT，Copyright (c) Doocs），按原 license 重新分发。裁剪范围与更新方式见 [vendor/doocs-md/UPSTREAM.md](vendor/doocs-md/UPSTREAM.md)。
