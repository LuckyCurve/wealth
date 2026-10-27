# AGENTS.md — 资产管理 (Wealth Management)

单文件个人资产管理 SPA。无构建工具、无后端；核心纯逻辑抽到 `logic.js`，用内置 `node --test` 单测。直接打开 `index.html` 即可使用。

## 项目结构

```
index.html            # 全部 HTML/CSS/JS
logic.js              # 与 DOM 无关的纯函数（UMD：浏览器挂全局 / Node require）；按域分组，页面经域名调用（text.esc）
test/                 # node --test（logic / ui-wiring 契约 / e2e-server / size-budget）
e2e/                  # Playwright 端到端（app / i18n / theme / consistency / glass-material / chart-resize / entrance + fixtures.js + server.js）
playwright.config.js
package.json          # 仅 devDependency: @playwright/test（无构建步骤）
.github/workflows/    # CI：三平台 node --test + Linux Playwright E2E
AGENTS.md             # 路标：结构、命令、怎么提交
LESSONS.md            # 踩过的坑与原因（改哪块读哪节）
GLOSSARY.md           # 领域术语（下拉控件 / 下拉弹层 / 巡检）
docs/adr/             # 不可逆且反直觉的决定（下拉弹层为什么用 base-select）
docs/code-standards.md # 评审规则（只留判断类；形态类归测试）
docs/agents/          # 工程技能的仓库约定（票存哪 / triage 标签 / 领域文档）
.gitignore            # 忽略 .superpowers/ .pi/ .scratch/ node_modules/ 与测试产物
```

## Agent skills

### Issue tracker
本地 markdown：`.scratch/<feature>/`（`spec.md` + `issues/NN-slug.md`），不进 git，票做完即删。
见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。

### Triage labels
默认五个角色名，落成票文件顶部的 `Status:` 行。见 [docs/agents/triage-labels.md](docs/agents/triage-labels.md)。

### Domain docs
单上下文：`GLOSSARY.md` + `docs/adr/`，懒创建。见 [docs/agents/domain.md](docs/agents/domain.md)。

## 开工前

1. 改哪块，先读 [LESSONS.md](LESSONS.md) 的对应小节：每条都对应一次真实翻车或用户原话。
2. 提交前对照 [docs/code-standards.md](docs/code-standards.md) 的清单；文末那张表里的规则由测试把守，直接跑测试。
3. 行为有变，同一 commit 更新文档；能写成测试的约定，写测试，不写文档。

## 技术栈

- **Tailwind CSS (CDN) + 自定义 CSS** — 暖色古纸质主题 + 暗色模式
- **Apache ECharts 5 (CDN)** — 旭日图（资产/收入/支出结构）+ 堆叠柱状图（历史净值/支出趋势）
- **@fawazahmed0/currency-api (CDN)** — 汇率
- **Flatpickr (CDN)** — 消费表单日期选择器（中文 locale、桌面样式）
- **Noto Serif SC / IBM Plex Mono / Cormorant Garamond (Google Fonts)**

## 功能模块

两大主模式（`switchMode`），默认 **消费**：资产模式、消费模式。每个模式内各有子 Tab（`switchTab`）。进入资产模式有长按门槛与一次确认（见 [LESSONS.md](LESSONS.md#门槛与模式入口)）。

## 核心数据模型 (localStorage key: `wealth-manager-data`)

```typescript
interface AppState {
  categories: Category[];        // 资产分类 [{ id, name, builtin, tags[] }]
  assets: Asset[];
  snapshots: Snapshot[];
  expenseCategories: Category[]; // 结构与 categories 相同，独立存储
  expenses: Expense[];
  rates: { CNY: 1, HKD: number, USD: number, fetchedAt: string | null };
  expenseExpectation: number;    // 预期月消费 (CNY)，0=未设置
  netWorthTarget: number;        // 目标净资产 (CNY)，0=未设置
  incomeSafetyFactor: number;    // 安全边际因子 (%)，默认 100，钳制 1~100
  runwayTags: { catId: string; tag: string }[];  // 读数卡所选标签，空 = 未选
  runwayExpectation: number;     // 读数卡自定月消费 (CNY)，0=用全局 expenseExpectation，不回填全局
  lang: 'en' | 'zh';             // 界面语言（用户设置），默认 en；分类/标签/备注是账本内容，不随它翻译
  backup: {
    autoFreq: 'daily' | 'weekly' | 'off';
    lastBackup: string | null;      // 只在**确认写入成功**后更新；也是「今天要不要再问」的唯一依据
    // 备份文件夹句柄不进 state（不可序列化），只存 IndexedDB；它只是文件窗口的起点目录
  };
}

interface Asset {
  id: string;
  name: string;
  amount: number;
  currency: 'CNY' | 'HKD' | 'USD';
  tags: { [catId: string]: string };  // 含 tags.currency
  expectedRateMin: number;    // 预期年利率下限 (%)，0=未设置
  expectedRateMax: number;    // 预期年利率上限 (%)
  cashRatio: number;          // 现金比例 (%) 0~100
}

interface Snapshot {
  month: string;              // 'YYYY-MM'，同月仅保留一条
  note: string;
  totalCNY: number;           // 加工字段：导出剥离，导入按 currencyRates 重算
  currencyRates: { ...state.rates };  // 快照当时的汇率
  assets: Asset[];            // 深拷贝
  updatedAt: string;
}

interface Expense {
  id: string;
  date: string;               // 'YYYY-MM-DD'
  amount: number;             // CNY
  note: string;
  tags: { [catId: string]: string };  // 引用 expenseCategories
}
```

- **内置分类 `currency`** 首次加载自动创建，不可编辑/删除。
- **消费分类与资产分类完全独立**（`expenseCategories`），颜色映射走 `expenseCatColor()` 而非 `catColor()`。
- **`migrateState()` 是迁移/兜底唯一入口**，`loadState()`（本地）与 `importData()`（导入）共用，保证旧版导出导入后行为一致。必须容忍：旧快照格式（迁移为月度、同月取最新）、缺失 `totalCNY`（按 `currencyRates` 重算）、缺失数组、缺失内置分类与汇率、用户设置字段非数字（归一为数字，非法归 0）、旧 `expectedRate`（迁移为 Min/Max）、`cashRatio` 缺失（默认 100）、资产/消费 `tags` 损坏或缺失、消费 `date` 缺失、读数卡的 `runwayTags`/`runwayExpectation`（引用清理、非法值归 0）、内置 `expense-type` 分类（移除并清理孤立引用）。

## 开发

无构建步骤，改完刷新浏览器生效。

### TDD（测试先行）

红-绿-重构：**先写失败测试 → 最小实现 → 重构**，不允许先改实现再补测试。

1. 纯逻辑加到 `test/logic.test.js`；DOM 接线/单一来源/旧入口契约加到 `test/ui-wiring.test.js`。测试即需求说明书。
2. 新增测试必须先失败（red），失败原因须与预期一致。
3. 只改到转绿，不夹带无关改动；绿灯下重构，每步重跑 `node --test`。
4. 一个独立问题一个 commit，提交前 `node --test` 全绿，独立 push。

单文件 SPA 没有组件引用可查，`onclick`/`innerHTML` 接线就是契约本身——视图层改动优先在 `ui-wiring.test.js` 用文本断言把守「单一来源」与「旧入口不回潮」。

### 文档与代码的边界（防漂移）

**文档只写「会改变决策的约束与为什么」；不写具体数值、实现步骤、UI 细节。**
那些由代码与契约测试承担，写进文档只会随实现漂移。分三层：

- `AGENTS.md`（本文件）：路标、命令、不可协商的流程。
- `LESSONS.md`：为什么，以及曾经怎么坏。
- `docs/code-standards.md`：评审时逐条核对的规则。

新增约定时先问：它能被测试守住吗？能就写测试；不能、且会改变决策，才写进 `LESSONS.md`。

## 单元测试

核心纯逻辑（换算、收益、迁移、日期、转义、颜色等）抽到 `logic.js`，UMD 双端复用：浏览器由 `<script src="logic.js">` 挂到全局，Node 下 `require`。

- 运行：`node --test`（零依赖，内置 `node:test` / `node:assert`）。
- `test/logic.test.js` — 纯函数单测。
- `test/ui-wiring.test.js` — 对 `index.html` 的文本契约断言，把守「单一来源 / 旧入口不回潮 / 关键接线」；完整清单见文件内 `describe` 标题。其中一条用 `new Function` 对整段内联脚本**做真解析**：单文件 SPA 没有构建步骤，一个顶层声明重名就会让整段脚本死在解析期（症状是「页面在、但没数字」，且 renderAll 之后的接线全部不存在）。
- `test/size-budget.test.js` — 体积预算，见下节。
- `test/e2e-hygiene.test.js` — E2E 用例卫生（禁用固定睡眠），把守下节那条铁律。
- 依赖全局 `state` / `incomeMode` 的函数，测试中经 `globalThis` 注入（`freshState()` 固定 `lang: 'zh'`：既有断言写的是中文文案）。
- 改动纯逻辑时同步更新 `logic.js` 与单测。

### 多语言

界面文案只有两条通道：静态文案挂 `data-i18n` / `data-i18n-<attr>`，动态模板调 `i18n.t('中文原文')`。
英文词条表在 `logic.js`（`i18n.I18N_EN`），键就是中文原文；语言是 `state.lang`，默认英文，随存档走。
为什么这么选见 [docs/adr/0002](docs/adr/0002-interface-language-source-keys.md)，踩过的坑见 [LESSONS.md](LESSONS.md#多语言界面语言)。

- 词条键必须与英文表同改；`ui-wiring` 的「多语言」用例把守三条：静态文本/属性都挂了标记、脚本里没有游离中文字面量、用到的键都有英文词条（且表里没有死词条）。
- 配置对象里只存取值函数（`() => i18n.t('…')`），不要直接写 `i18n.t(...)`——模块级对象会把加载时的语言冻住。
- 账本内容（分类名/标签/备注）不翻译；内置分类名只在**创建那一刻**取当前语言。

## 体积预算

单文件是这套架构的代价：`index.html` 只会越来越大，而一个 AI 一次能稳妥改动的文件是有限的。
`test/size-budget.test.js` 卡住 `index.html` 的字节数，超了测试直接红。超了先做前两步，
不要第一反应抬预算：

1. 纯逻辑下沉 `logic.js`（可单测，也是它该在的地方）。
2. 视图侧合并重复结构、把内联样式收回 `<style>`。
3. 确实需要更多空间：在**同一个 commit** 里抬高 `BUDGET` 常量，并在提交正文写明为什么；
   只抬不改视为违规。

## 端到端测试（Playwright）

真实浏览器里跑一遍：`npm run test:e2e`（`npx playwright test`）。跑在 `e2e/`，与 `node --test` 的 `test/` 完全分开（后者只拾取 `test/*.test.js`）。CI 上 Linux + chromium 单矩阵即可，E2E 验证的是应用行为、与 OS 无关。

- **不访问外网**：汇率 / echarts / tailwind / flatpickr / 字体全部 `page.route` stub（见 `e2e/fixtures.js`）。要测的是应用自身行为，不是 CDN 可用性；断网也能跑。想验真实库行为时不要临时放行外网——要么把要断言的东西做成纯 DOM，要么承认替代物看不见，并在本地用像素/量测确认。
- **Tailwind 在 E2E 里是空壳**：`window.tailwind = {}`，所以工具类（`flex`/`gap-3`/`grid-cols-2`）在 E2E 里不生效——截图不能用来验收 Tailwind 布局。这也是「版式规格必须写在自有 CSS 里」的原因之一。
- **版式巡检（`consistency.spec.js`）**：同类元素的计算样式集合须为 1，表头与数据行列宽须相等，同档字号/字重唯一，展示档逐级递减。新增同类结构时不必改测试（判据从页面自身求值）；它拓的是「写对 class 但被覆盖 / 漏挂 class」这类单测看不见的漏洞。另有一条**全站文字对比度 ≥ AA** 巡检（亮/暗两套；「有意淡出」的元素显式豁免）。
- **route 后注册者优先**：兜底「拦掉一切外网」必须先注册，具体 CDN 替身后注册才能覆盖它。次序写反会让所有替身失效且不报错，只表现为一串莫名失败。
- **先关动效再断言数字**：masthead 净资产是计数动画，等它收敛会让每个数字断言吃满超时。`fixtures` 里统一 `emulateMedia({ reducedMotion: 'reduce' })`。
- **E2E 里禁止 `waitForTimeout` 睡眠**：`switchTab` 的 display 翻转、`setTheme` 的 classList 翻转都是同步的，用可见断言即可到位；固定等待会让主题巡检这类全 Tab 遍历的用例凭空多吃数秒（曾占全套时长的 1/3）。确需等待异步渲染时用 `expect.poll`。`test/e2e-hygiene.test.js` 扫 `e2e/*.spec.js` 把守这一条。
- **进资产的入口只有 `fixtures.gotoAssets()` 一处**：它走键盘通道（合成 click）直达确认框，既不必等满按住时长，也顺带护住「不用鼠标的人不被挡在门外」这条路径；长按手势本身由 `app.spec.js` 的专测用真实鼠标覆盖。已在资产模式时为幂等（不再走门）。
- **语言默认英文，播种要显式选中文**：既有用例的断言写的都是中文文案，`fixtures` 的 `EMPTY_STATE`/`blankPage` 已固定 `lang: 'zh'`；默认英文与切换本身由 `e2e/i18n.spec.js` 覆盖（含一次「英文界面无中文残留」的全 Tab + 弹窗巡检）。
- **读内存态 vs 读存档**：`migrateState()` 只修内存态、不回写 localStorage。验证「已落盘」读 localStorage，验证「迁移/兜底已生效」读 `state`。
- **seed 只在首次导航生效**：`addInitScript` 对每次导航（含 reload）都会重跑，若无条件覆盖，reload 会把存档洗回种子值 —— 持久化用例会「永远绿」（假通过）。标记用 sessionStorage（同一标签页跨 reload 存活、每个用例独立）。
- **OPFS 句柄不能跨 reload 读回**：目录写入用例用 `navigator.storage.getDirectory()` 造真实可写句柄，但 headless Chromium 从 IndexedDB 反序列化该句柄会让渲染进程崩溃（真实选择器句柄不受影响）。因此只断言记录已写入（`getAllKeys`），不在 reload 后使用它。
- **静态服务器的健康检查要验明正身**：`webServer.url` 指向 `/__e2e_health__`（仅本服务器提供）。`reuseExistingServer` 只看端口是否响应，固定端口被别的服务占用时会静默连错，症状是一堆难以理解的失败。
- 静态服务器 `e2e/server.js` 是零依赖的、只服务本项目目录；不用 `file://`，因为 localStorage 在 file origin 下不可靠。
- TDD 同样适用：E2E 是发现「能打开但点不动」这类 bug 的地方（如原生 `step` 校验静默拦截提交），先写失败用例再改实现。

## 提交信息

主题用 Conventional Commits，中文，一行说清「改了什么、为什么」：
`feat:` / `fix:` / `refactor:` / `style:` / `docs:`。

正文按下面六项写，没有的写「无」，不要省：

1. **复现** — 用户原话、环境、输入。截图里的文字抄下来，不要转述成「类似的情况」。
2. **改了什么** — 行为的前后对比；不只列文件。
3. **兄弟** — 同一个 bug 的其他入口、同类结构查了哪些；改了哪些，哪些确认不用改。
4. **跑过什么** — 精确命令与结果：`node --test`、哪个 spec、手工步骤。
5. **没跑什么** — 明确说。写「应该没问题」等于没跑。
6. **破坏验证** — 把实现回退或改坏，确认新测试真的变红。

commit 是给下一个 AI 看的，不是给 changelog 看的。**不写运行记录，视为没跑。**
提交前 `node --test` 必须全绿；大改动再跑一遍 `npm run test:e2e`，并在正文写明。
