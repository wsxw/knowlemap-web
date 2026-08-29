# KnowleMap Web — 知识地图学习应用（Web 版）

由 macOS SwiftUI 版（`../KnowleMap-Mac`）重构而来的 Web 项目。基于「先行组织者 + 知识地图定位 + 闯关测试游戏化」学习法。

**视觉风格**：活泼学习游戏风——渐变背景、大圆角卡片、游戏关卡式节点、贝塞尔学习路径（可学习节点入边流动虚线动画）、通关彩带，支持亮/暗双主题（右上角 🌙/☀️ 切换，跟随系统偏好、localStorage 记忆）。

**课程内容**：与 Mac 版共用同一份 `content.json`（schema v2）：英语 A1–A2 全量课程，6 大模块 / 15 个子系统 / 60 节点 / 240 道测试题。

## 运行

```bash
cd KnowleMap-Web
pnpm install          # 或 npm install
pnpm dev              # 开发服务器 http://localhost:5173
pnpm build            # 类型检查 + 生产构建（输出 dist/）
pnpm preview          # 预览生产构建 http://localhost:4173
pnpm selftest         # 核心规则自测（vitest，12 项）
```

## 技术栈与结构

Vite + React 18 + TypeScript。UI 动效基于 [beUI](https://beui.dev/)（MIT，复制式动效组件库，经 shadcn registry 拉取源码进仓库）+ [Motion](https://motion.dev/)；Tailwind 4 仅作工具类层（未启用 preflight，不影响手写样式）。地图用 SVG 自绘（平移/缩放/连线），进度存 localStorage。

```
KnowleMap-Web/
├── src/
│   ├── domain/            # CoreDomain 移植：models.ts + learningEngine.ts（纯函数规则引擎，零 UI 依赖）
│   ├── content/           # ContentKit 移植：解析 + 建索引 + 校验（contentStore.ts）
│   ├── data/content.json  # 课程内容包（自 Mac 版复制，schema v2）
│   ├── persistence/       # PersistenceKit 移植：localStorage 持久化（损坏自动备份重开）
│   ├── state/AppModel.ts  # 全局应用模型（框架无关 store，React 经 useSyncExternalStore 订阅）
│   ├── components/        # Sidebar / MapCanvas / NodeDetail / QuizView / RewardOverlay / Confetti
│   ├── components/motion/ # beUI 动效组件（number-ticker / animated-number，shadcn registry 拉取）
│   ├── lib/               # cn() 合并工具 + beUI 缓动/弹簧常量
│   ├── selftest/          # 规则引擎自测（对齐 Mac 版 8 项 + 内容包完整性）
│   ├── App.tsx            # 三栏布局：侧栏 | 知识地图 | 节点详情 + 可拖分栏 + 奖励弹层
│   ├── tailwind.css       # Tailwind 入口（theme + utilities，无 preflight）
│   └── styles.css
├── components.json        # shadcn registry 配置（npx shadcn add @beui/<组件> 增补组件）
├── index.html
├── vite.config.ts
└── tsconfig.json
```

## 已实现功能（与 Mac 版对齐）

- **知识地图**：SVG 自绘，圆点网格画布，节点五态（未解锁灰 / 可学蓝渐变+呼吸光晕 / 进行中橙 / 已掌握绿 / 待上线虚线灰），贝塞尔曲线前置连线（可学习入边流动虚线、已掌握连线绿色微光），hover 浮起、选中弹跳，拖拽平移、滚轮缩放（光标锚定）、一键适配，玻璃拟态图例。
- **双主题**：亮/暗两套设计令牌（`html[data-theme]` 切换），默认跟随系统，手动切换记忆到 localStorage。
- **多模块 + 分级导航**：侧栏按「模块 → 子系统」分组，A1/A2 级别筛选。
- **面包屑定位**：`英语 › 语法 › 时态系统 › 一般现在时`。
- **节点学习页**：先行组织者 → 讲解（文字/例句/比喻）→ 自由写作练习（附参考示例），级别角标，彩色边条卡片。
- **闯关测试**：选择 + 填空（⌘/Ctrl+↩ 提交），逐题即时反馈（答对弹跳/答错摇摆）与解析，正确率 ≥80% 通关。
- **游戏化**：XP（首次通关 +50，防刷分）、等级、5 枚徽章、通关彩带 + XP 数字滚动弹层（徽章芯片高光扫过）、解锁提示、下一步推荐。
- **进度系统**：主题/模块/子系统进度条（渐变+流光）、节点掌握度，localStorage 持久化，刷新不丢。
- **可调分栏**：地图栏与详情栏之间的分隔条可拖动调整宽度（380–760px），双击复位，宽度记忆到 localStorage。
- **Web 版新增**：「清空进度」重置按钮、可调分栏、双主题。

## 相对 Mac 版修复的问题

| # | Mac 版问题 | Web 版处理 |
|---|-----------|-----------|
| 1 | 前置连线端点用 `unit×(宽/2, 高/2)` 近似，斜线起止点偏离节点框边缘 | 按线段与矩形边界精确求交 |
| 2 | 地图点击与拖拽手势并存，拖拽结束可能误触选中节点 | 指针移动超过阈值即判定为拖拽，不再触发选中 |
| 3 | 级别筛选后无节点时画布空白且无提示 | 显示「当前级别筛选下没有节点」空态提示 |
| 4 | 进度条 value=0 时因 `max(8, …)` 仍显示 8px 存根 | 严格按比例渲染 |
| 5 | XP 恰为 100 倍数时侧栏仍提示「再得 100 XP 升级」（实际刚升级） | 边界显示「已抵达下一级」 |
| 6 | 缩放以画布中心为锚点 | 以光标位置为锚点缩放，操作更直觉 |
| 7 | `finishQuiz` 中 `pack!` 强制解包有崩溃风险 | 全程可选值守卫 |
| 8 | 填空题仅 ⌘↩ 提交 | 额外支持回车提交、评测后回车进入下一题 |
| 9 | 点击节点后地图跟着鼠标走（节点的 `stopPropagation` 拦截了 svg 的 pointerup，拖拽状态残留，松手后移动鼠标被误判为拖拽） | 节点 pointerup 不再阻断冒泡，svg 统一结束拖拽状态；并以 pointerId 校验事件归属 |
| 10 | 中/右栏边界随详情内容自动伸缩（`minmax(380px, 42vw)` 会按内容撑开） | 边界改为用户手动控制：分隔条拖动调整宽度、双击复位、localStorage 记忆 |
| 11 | 拖动地图后点击另一个节点，视口被重置回初始位置。根因：`.app-shell` 未定义行高，隐式 auto 行被详情栏长内容撑高（容器 858px → 1129px），ResizeObserver 触发重新适配 | 网格加 `grid-template-rows: minmax(0, 1fr)` 锁定行高，详情内容内部滚动；同时用 `useMemo` 稳定节点数组引用，视口适配只在挂载/容器尺寸/地图与筛选变化时执行 |

## 增补 beUI 动效组件

项目引入了 [beUI](https://beui.dev/)（动效组件库，Motion + Tailwind 4）。新增组件只需一条命令（源码复制进仓库，可自由修改）：

```bash
npx shadcn@latest add @beui/<组件名> --overwrite
```

已接入：`number-ticker`（奖励弹层 XP 滚动数字）、`animated-number`（侧栏总 XP 数字动画）。运行时依赖 `motion`、`clsx`、`tailwind-merge`；Tailwind 配置见 `src/tailwind.css`（未启用 preflight，与既有样式零冲突）。

## 数据模型（schema v2，与 Mac 版一致）

```
Domain（英语）
 └── Module（语法/词汇/发音/功能/语篇/技能）
      └── KnowledgeMap / 子系统（时态系统…）
           └── KnowledgeNode（level · comingSoon · 先行组织者 · 讲解 · 练习 · 测试 · 前置/关联 · 布局坐标）
```

新增内容只需修改 `src/data/content.json`（补 `organizer/explanation/activity/quiz`），应用零改动即可上线；加载时会自动执行与 Mac 版相同的引用完整性校验。
