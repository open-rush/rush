# Lux UI Design System

> 定义 lux Web UI 的视觉语言、组件规范和交互模式。
> 第一版目标：**可用的 AI 对话工作台**，不追求花哨，追求清晰、一致、快速。

## 设计原则

1. **Monochrome-first** — 主色调灰度（OKLCH），彩色仅用于状态指示和数据可视化
2. **Content-dense** — AI 对话是核心，最大化内容区域，最小化 chrome
3. **Dark-mode native** — 不是事后补的，从 Day 1 双主题
4. **Mobile-aware** — 移动端可用（不是优先），关键断点 `md:768px`
5. **Accessible** — focus ring、ARIA label、键盘导航，不妥协

## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| CSS 框架 | Tailwind CSS v4 | utility-first，与 Next.js 16 集成 |
| 组件库 | shadcn/ui + Radix | 无样式基础组件，自定义主题 |
| 图标 | Lucide React | 统一风格，tree-shakable |
| 动画 | CSS transitions + Tailwind animate | 轻量，不引入 framer-motion |
| 工具 | clsx + tailwind-merge (`cn()`) | 条件类名合并 |

## 色彩系统 (OKLCH)

OKLCH 色彩空间，确保亮/暗模式下感知一致性。

### Light Mode

```css
:root {
  --background: oklch(1 0 0);              /* #FFFFFF */
  --foreground: oklch(0.145 0 0);          /* 近黑 */
  --primary: oklch(0.205 0 0);             /* 深灰 */
  --primary-foreground: oklch(0.985 0 0);  /* 近白 */
  --secondary: oklch(0.97 0 0);            /* 浅灰背景 */
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);               /* 禁用/次要 */
  --muted-foreground: oklch(0.556 0 0);    /* 中灰文字 */
  --accent: oklch(0.97 0 0);              /* 高亮背景 */
  --destructive: oklch(0.577 0.245 27.325); /* 红色 */
  --border: oklch(0.922 0 0);             /* 边框灰 */
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);               /* focus ring */
  --radius: 0.625rem;                     /* 10px 默认圆角 */
}
```

### Dark Mode

```css
.dark {
  --background: oklch(0.145 0 0);          /* 深色背景 */
  --foreground: oklch(0.985 0 0);          /* 浅色文字 */
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --border: oklch(1 0 0 / 10%);           /* 白色 10% 透明 */
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}
```

### 状态色

| 状态 | 用途 | 色值 |
|------|------|------|
| destructive | 错误/删除 | `oklch(0.577 0.245 27.325)` |
| success | 成功 | `oklch(0.6 0.2 145)` (绿) |
| warning | 警告 | `oklch(0.75 0.15 85)` (橙) |
| info | 信息 | `oklch(0.6 0.118 184.704)` (蓝) |

## 排版

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC",
             "Segoe UI", "Hiragino Sans GB", "Microsoft YaHei",
             "Helvetica Neue", Helvetica, Arial, sans-serif;

--font-mono: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono",
             Consolas, "Courier New", monospace;
```

| 层级 | 大小 | 权重 | 用途 |
|------|------|------|------|
| 标题 | `text-lg` / `text-xl` | `font-semibold tracking-tight` | 页面/区块标题 |
| 正文 | `text-sm` (桌面) / `text-base` (移动) | `font-normal` | 主要内容 |
| 次要 | `text-sm` | `font-normal text-muted-foreground` | 描述、时间戳 |
| 代码 | `text-xs` | `font-mono` | 代码块、终端 |
| 标签 | `text-xs` | `font-medium` | Badge、状态标签 |

## 间距系统

| 级别 | Tailwind | 像素 | 用途 |
|------|----------|------|------|
| xs | `gap-1` / `p-1` | 4px | 组件内紧凑间距 |
| sm | `gap-2` / `p-2` | 8px | 默认元素间距 |
| md | `gap-3` / `p-3` | 12px | 卡片内边距 |
| lg | `gap-4` / `p-4` | 16px | 区块间距 |
| xl | `gap-6` / `p-6` | 24px | 页面级间距 |

## 圆角

| 级别 | Tailwind | 用途 |
|------|----------|------|
| sm | `rounded-md` (6px) | 小元素（badge） |
| default | `rounded-lg` (10px) | 按钮、输入框 |
| lg | `rounded-xl` (12px) | 卡片 |
| full | `rounded-full` | 头像、圆形按钮 |

## 阴影

| 级别 | Tailwind | 用途 |
|------|----------|------|
| sm | `shadow-sm` | 输入框、小组件 |
| md | `shadow-md` | 浮动面板 |
| lg | `shadow-lg` | 卡片、弹窗 |
| hover | `hover:shadow-xl` | 卡片悬浮态 |

## 核心布局

### App Shell

```
┌─────────────────────────────────────────────┐
│ Sidebar (240px, collapsible)  │  Main Area  │
│ ┌─────────────────────────┐   │             │
│ │ Logo + New Project btn  │   │  [Content]  │
│ │ Search                  │   │             │
│ │ ───────────────────── │   │             │
│ │ Today                   │   │             │
│ │   Project A ●           │   │             │
│ │   Project B             │   │             │
│ │ Yesterday               │   │             │
│ │   Project C             │   │             │
│ │ ───────────────────── │   │             │
│ │ Settings  │  User Avatar│   │             │
│ └─────────────────────────┘   │             │
└─────────────────────────────────────────────┘
```

- Sidebar: `w-[240px]` 常态，`w-0` 折叠，`transition-all duration-200`
- Sidebar 背景: `bg-secondary rounded-xl`
- 分组标题: `text-xs text-muted-foreground uppercase`
- 活跃项目: `bg-accent` 高亮

### 对话界面

```
┌─────────────────────────────────────────────┐
│                 Chat Messages               │
│                                             │
│  [Assistant]  回答内容...                    │
│              ┌─ Tool: Bash ──────────────┐  │
│              │ $ echo hello              │  │
│              │ > hello                    │  │
│              └───────────────────────────┘  │
│                                             │
│                        [User]  你好 ←      │
│                                             │
│  [Assistant]  正在思考...                    │
│                                             │
├─────────────────────────────────────────────┤
│ ┌─ 输入区 ──────────────────────────────┐  │
│ │ [Attach] 输入消息...      [Model ▾] → │  │
│ └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**消息布局规则**:
- 用户消息: 右对齐，`bg-secondary rounded-lg px-4 py-3`，最大宽度 80%
- 助手消息: 左对齐，全宽，无背景
- 工具调用: 可折叠卡片，`border rounded-lg`，标题含工具图标 + 状态
- 代码块: `bg-secondary/50 rounded-md` + 语法高亮 + 复制按钮

**滚动行为**: `use-stick-to-bottom` — 新消息自动滚到底部，用户手动上滚时停止

### 输入区

- 全宽 textarea，`field-sizing-content` 自适应高度
- 左侧: 附件按钮
- 右侧: 模型选择器 + 发送按钮
- 快捷键: `Cmd+Enter` 发送

## 组件规范

### Button

```
// 变体
default:     bg-primary text-primary-foreground hover:bg-primary/90
destructive: bg-destructive text-white hover:bg-destructive/90
outline:     border bg-background hover:bg-accent
secondary:   bg-secondary text-secondary-foreground hover:bg-secondary/80
ghost:       hover:bg-accent hover:text-accent-foreground
link:        text-primary underline-offset-4 hover:underline

// 尺寸
sm: h-8 px-3 rounded-lg
default: h-9 px-4 py-2 rounded-lg
lg: h-10 px-6 rounded-lg
icon: size-9 rounded-lg

// 通用
transition-all duration-200
disabled:pointer-events-none disabled:opacity-50
focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]
```

### Input

```
h-9 w-full px-3 py-1
rounded-lg border border-border bg-white
text-foreground placeholder:text-muted-foreground
shadow-sm transition-all duration-200
hover:border-primary/50
focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20
disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted
```

### Card

```
rounded-xl border bg-card text-card-foreground shadow-lg
hover:shadow-xl transition-shadow
```

### Badge

```
// 变体
default:     bg-primary text-primary-foreground
secondary:   bg-secondary text-secondary-foreground
destructive: bg-destructive text-white
outline:     border text-foreground

// 通用
inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
```

### Tool Execution Card

```
┌─ 🖥️ Bash ─────────────────── [Running ●] ─┐
│ $ npm install express                        │
│ ─────────────────────────────────────────── │
│ added 64 packages in 2.1s                    │
└──────────────────────────────────────────────┘

// 结构
border rounded-lg overflow-hidden
Header: px-3 py-2 flex items-center gap-2 bg-secondary/50
  - 工具图标 (Bash/Read/Write/Edit/Grep/Glob)
  - 工具名 text-sm font-medium
  - 状态 badge (streaming/completed/error)
  - 折叠箭头 ChevronDown
Body: px-3 py-2 font-mono text-xs
  - Input 区: 命令/路径
  - Output 区: 执行结果
Error: bg-destructive/10 text-destructive rounded-md p-2
```

## 暗色模式

**实现方式**: class-based (`.dark` on `<html>`)

**防闪烁**: `<head>` 内联脚本读 `localStorage.theme`，在 React hydrate 前设置 `.dark`

```html
<script>
  (function() {
    const t = localStorage.getItem('theme');
    if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  })();
</script>
```

**切换**: 三态 `light | dark | system`，存 localStorage

## 响应式断点

| 断点 | 宽度 | 行为 |
|------|------|------|
| 默认 | < 768px | 隐藏 sidebar，全屏对话 |
| `md` | >= 768px | 显示 sidebar，标准布局 |
| `lg` | >= 1024px | 加宽内容区 |

移动端: `text-base`（16px 避免 iOS 缩放）→ 桌面: `md:text-sm`

## 交互状态

| 状态 | 样式 |
|------|------|
| Hover | `hover:bg-accent` 或 `hover:bg-primary/90` |
| Focus | `focus-visible:ring-[3px] focus-visible:ring-ring/50` |
| Active | `active:scale-[0.98]`（按钮） |
| Disabled | `disabled:opacity-50 disabled:pointer-events-none` |
| Loading | `animate-pulse` 或 `Loader2` 旋转图标 |
| Error | `border-destructive ring-destructive/20` |

## 动画

保持克制，仅用于反馈和过渡：

| 动画 | 用途 | 实现 |
|------|------|------|
| 过渡 | 所有交互元素 | `transition-all duration-200` |
| 脉冲 | 加载占位 | `animate-pulse` |
| 旋转 | 加载图标 | `animate-spin` |
| 渐入 | 新消息 | `opacity-0 → opacity-100 duration-300` |
| 骨架 | 内容加载中 | `bg-muted animate-pulse rounded` |

**不做**: 过度装饰性动画（float、shimmer、gradient-border 等留给营销页）

## 安装 shadcn/ui

```bash
# 在 apps/web 下初始化
npx shadcn@latest init
# 按需添加组件
npx shadcn@latest add button input card badge dialog dropdown-menu
npx shadcn@latest add tabs scroll-area separator avatar tooltip
npx shadcn@latest add command sheet popover
```

## 文件结构

```
apps/web/
├── components/
│   ├── ui/              # shadcn/ui 组件 (Button, Input, Card...)
│   ├── chat/            # 对话相关
│   │   ├── message-list.tsx
│   │   ├── message-bubble.tsx
│   │   ├── tool-card.tsx
│   │   ├── code-block.tsx
│   │   ├── prompt-input.tsx
│   │   └── chat-view.tsx
│   ├── layout/          # 布局
│   │   ├── app-shell.tsx
│   │   ├── sidebar.tsx
│   │   └── header.tsx
│   └── shared/          # 通用
│       ├── theme-toggle.tsx
│       ├── user-menu.tsx
│       └── empty-state.tsx
├── lib/
│   ├── utils.ts         # cn() helper
│   └── auth-adapter.ts  # NextAuth adapter
└── app/
    ├── globals.css       # CSS variables + Tailwind
    ├── layout.tsx        # Root layout + providers
    ├── (auth)/           # 认证相关页面
    │   └── login/
    └── (app)/            # 需认证的页面
        ├── layout.tsx    # App shell (sidebar + main)
        └── projects/
            └── [id]/
                └── page.tsx  # 对话界面
```
