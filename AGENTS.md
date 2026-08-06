# AGENTS.md — 资产管理 (Wealth Management)

单文件个人资产管理 SPA。无构建工具、无测试、无后端。直接打开 `index.html` 即可使用。

## 项目结构

```
index.html   # 全部 HTML/CSS/JS (~3339 行)
AGENTS.md
.gitignore   # 忽略 .superpowers/ 和 .pi/
```

## 技术栈

| 技术 | 用途 |
|---|---|
| Tailwind CSS (CDN) + 自定义 CSS | 暖色调古纸质 (parchment ledger) 主题 + 暗色模式 |
| Apache ECharts 5 (CDN) | 旭日图 (资产/收入/支出结构) + 堆叠柱状图 (历史净值/支出趋势) |
| @fawazahmed0/currency-api (CDN) | 汇率 (`1 CNY = ? HKD/USD`，见下方换算说明) |
| Noto Serif SC / IBM Plex Mono / Cormorant Garamond (Google Fonts) | 标题 / 正文+数字 / 报头 (masthead) 装饰，`display=swap` 加载 |

## 功能模块

两大主模式 (`switchMode`)，默认进入 **消费** 模式：

- **资产模式** (`currentMode='assets'`)：资产清单、分类管理、资产分布、历史净值、收益测算
- **消费模式** (`currentMode='expenses'`)：消费记录、分类管理、消费分布、消费趋势

每个模式内各自又有子 Tab (`switchTab`)。资产模式 5 个 Tab，消费模式 4 个 Tab。

## 核心数据模型 (localStorage key: `wealth-manager-data`)

```typescript
interface AppState {
  categories: Category[];        // 资产分类 [{ id, name, builtin, tags[] }]
  assets: Asset[];               // 资产 (见下)
  snapshots: Snapshot[];         // 月度快照 (见下)
  expenseCategories: Category[]; // 消费分类，结构与 categories 相同，独立存储
  expenses: Expense[];           // 消费记录 (见下)
  rates: { CNY: 1, HKD: number, USD: number, fetchedAt: string | null };
  expenseExpectation: number;    // 预期月消费 (CNY)，消费趋势参考线，0=未设置
  netWorthTarget: number;        // 目标净资产 (CNY)，masthead 进度条，0=未设置
}

interface Asset {
  id: string;                 // genId() = Date.now()-前缀
  name: string;
  amount: number;
  currency: 'CNY' | 'HKD' | 'USD';
  tags: { [catId: string]: string };  // 含自动同步的 tags.currency
  expectedRateMin: number;    // 预期年利率下限 (%)，0 表示未设置
  expectedRateMax: number;    // 预期年利率上限 (%)
  // 旧版曾用单一 expectedRate，migrateState() 会迁移为 Min/Max 并 delete expectedRate
}

interface Snapshot {
  month: string;              // 'YYYY-MM'，同月仅保留一条
  note: string;
  totalCNY: number;           // 加工字段：导出时被剥离，导入时按 currencyRates 重算补全
  currencyRates: { ...state.rates };  // 快照当时的汇率
  assets: Asset[];            // 深拷贝
  updatedAt: string;          // ISO 时间戳
  // 旧版用 { id, date }，migrateState() 迁移为月度格式
}

interface Expense {
  id: string;
  date: string;               // 'YYYY-MM-DD'
  amount: number;             // CNY
  note: string;
  tags: { [catId: string]: string };  // 引用 expenseCategories
}
```

**内置分类 `currency`**: `{ id:'currency', name:'货币类型', builtin:true, tags:['CNY','HKD','USD'] }` — 首次加载自动创建，不可编辑/删除。资产的 `tags.currency` 在 `saveAsset()` 中由下拉选择直接赋值（`tags['currency'] = currency`），无需独立同步函数。

**消费分类** 与资产分类完全独立（`expenseCategories` / `expenses`），颜色映射走 `expenseCatColor()` 而非 `catColor()`。旧版曾内置 `expense-type` 分类，`migrateState()` 会过滤移除并清理孤立标签引用。

**迁移/兜底统一入口 `migrateState()`** — `loadState()`（本地加载）与 `importData()`（JSON 导入）共用，保证旧版导出导入后行为一致。处理项：
- 旧快照格式 `{id,date}` → 月度格式（按 `date.slice(0,7)` 分组，同月取最新）
- 快照缺失 `totalCNY` → 按 `currencyRates`（回退 `state.rates`）重算
- 缺失 `categories`/`assets`/`expenses`/`expenseCategories` 数组兜底
- `currency` 内置分类缺失时自动创建；`rates` 缺失/损坏时重置，补全 `HKD`/`USD`
- 用户设置字段缺失时补 0：`expenseExpectation`、`netWorthTarget`
- `expectedRate` → `expectedRateMin/Max` 迁移并 `delete`；利率/金额字符串统一 `Number()` 转数字（导入数据防御）
- 移除内置 `expense-type` 消费分类 + 清理 `expenses[].tags` 孤立引用

## 关键发现

- **所有代码在单文件中** — 结构顺序：`<head>` (内联暗色脚本 + Tailwind config + `<style>` 自定义 CSS 变量) → `<body>` (HTML) → 末尾 `<script>` (全部 JS)。修改时保持此结构。
- **汇率字段含义已反转** — `state.rates` 存的是「1 外币 = X CNY」（`HKD: 1/cny.hkd`，`USD: 1/cny.usd`），所以 `toCNY(amount, cur) = amount * state.rates[cur]` 直接相乘即可。AGENTS 旧版描述的「取倒数」已体现在赋值处，调用方无需再处理。
- **汇率刷新** — `fetchRates()` 用 `cny.json` 端点且 `cache: 'no-store'`（CDN 7 天缓存导致普通刷新拿不到新汇率）；`pageshow`（bfcache 恢复）与 `visibilitychange`（切回标签页、上次拉取超 1 小时）触发刷新并重渲染；拉取成功后调用 `refreshVisibleCharts()` 同步重绘当前可见图表。失败时回退保存的汇率并提示「使用缓存汇率」。
- **图表统一重绘入口 `refreshVisibleCharts()`** — 汇率刷新与暗色切换共用，仅重绘当前可见 tab 的图表（隐藏 tab 下次进入时用新主题渲染）。
- **标签关联清理** — 删除分类/标签或编辑分类标签列表时，必须同步清理 `assets[].tags`（资产）或 `expenses[].tags`（消费）中的无效引用。`migrateState()` 已含迁移期清理逻辑。
- **ECharts 全局单例** — 五个实例变量：`chart`(资产旭日图)、`historyChart`(历史净值堆叠柱)、`incomeChart`(收入旭日图)、`expenseChart`(消费旭日图)、`expenseTrendChart`(支出趋势堆叠柱)。均用 `setOption(data, true)` 更新；`window resize` 在 `DOMContentLoaded` 顶层统一注册。`historyChartMode` 支持 `'value' | 'percent'`，`expenseTrendMode` 同理。
- **颜色系统** — CSS 变量 (`--bg`, `--fg`, `--muted`, `--accent`, `--verdigris`, `--down` 等) 控制主题；`--down` 为下跌/警示红（亮 `#b85450` / 暗 `#d98a86`），新代码优先用它而非写死色值；`CATEGORY_COLORS` (10 色 `{bg,fg,border}` 数组) 为分类基础色；`catColor(catId, tagName)` / `expenseCatColor(...)` 在同分类内按标签索引对 HSL 亮度做插值区分；旭日图另用 `CATEGORY_PALETTE` (10 色 `{base, shades[]}` 数组)。
- **资产表单验证** — 非 `currency` 分类在每个下拉选择器中均 `required`，未选则报错；`expectedRateMin` 不能大于 `expectedRateMax`（空值会自动用另一值补齐）。金额输入用 `formatMoneyInput()`（oninput）实时千分位格式化，回填用 `moneyStr()`。
- **美元/港币货币符号** — 代码中用 `HKD $` / `USD $` 区分，CNY 用 `formatCNY()` 输出 `¥`。
- **三态排序** — 资产 `toggleSort(field)` 与消费 `toggleExpenseSort(field)` 均为三态循环（升序 → 降序 → 取消排序恢复自然顺序）。消费侧首击保留旧行为（`expenseSortTouched` 标记后进入三态循环）。主键相同时按 `id`（创建顺序）次级排序。
- **资产拖拽排序** — `onAssetDragStart/DragOver/DragEnd/Drop` 拖拽调整 `state.assets` 顺序并保存，排序后自动清除 `sortBy` 恢复自然顺序。
- **月度快照** — 同月仅保留一条，重复记录会提示「覆盖更新」。快照详情的标签颜色与资产管理列表保持一致（复用 `catColor`）。快照同时保存当时汇率 `currencyRates`。历史净值 Tab 中每条快照显示环比：首月 / 新增 / `▲▼ x.x%`（`getPrevSnapshot()` 取上一个月份）。「对比快照」弹窗（`openCompareModal`/`renderCompareTable`）按资产 id 关联两月快照逐资产 diff（新增/移除徽章、按变动额降序），金额按各快照当时 `currencyRates` 折算 CNY；弹窗顶部为「总净值变动」hero 数字（`font-masthead`，2 位小数），表格列头用账本语汇「期初/期末」，变动列带按比例宽度迷你量条（`.cmp-bar`）；示例数据的快照资产 id 跨月稳定（与真实记录流程一致），对比才能按 id 关联出差异。
- **收入测算** — 基于 `expectedRateMin/Max` 计算 `calcAssetIncome()`（`getAssetRate()` 按 `incomeMode` `'min'|'max'` 取值），支持切换；展示年/月/日收益 + 加权平均利率。旭日图按资产聚合（仅统计有利率的资产）。
- **目标净资产** — `netWorthTarget` 在 masthead 显示进度条（`openTargetModal`/`saveTarget`/`clearTarget`），90%+ 变强调色、达成显示「目标已达成」徽章；总资产为 0 时不显示进度避免误报。masthead 副行同时展示「N 项资产」与预估月收益（任一资产设了利率即出现）。达成预测：`predictTarget()` 取最近 6 段快照月均净值增量（按快照月份间隔归一化）反推达成月份，展示于 masthead 目标面板与目标弹窗（`renderTargetPrediction`）；数据不足 / 已达成 / 月增量 ≤ 0 返回 null，预测超 20 年显示「20 年以上」。
- **消费记录** — 排序状态 `expenseSortBy`/`expenseSortDir`；「复制」操作 `duplicateExpense(id)` 打开新增窗口预填金额/备注/标签、日期改为今天；月份筛选 `expenseMonthFilter`（下拉由 `populateExpenseMonthFilter()` 生成）。趋势图按月聚合，与历史净值柱状图风格一致。
- **消费趋势** — `expenseExpectation` 设定后作为水平参考线，超线月份的柱顶 label 标红加 ▲；按钮状态化显示「设定预期 / 预期 ¥X」；透明「合计」系列不占高度、随 legend 选中实时重算。趋势下方按月列表 `viewExpenseMonth()` 查看当月明细。
- **暗色模式** — `toggleDark()` 写 `localStorage['dark-mode']`（`'1'`=暗色、`''`=亮色、`null`=未设置），通过 `document.documentElement.classList.toggle('dark')` 切换 `:root.dark` 下的 CSS 变量。`<head>` 内联脚本在渲染前设置主题：首次访问跟随系统 `prefers-color-scheme`，显式切换后以存储值为准（避免首屏闪烁）。
- **报头 (masthead) 数字动画** — `renderMasthead()` 用 `requestAnimationFrame` 做缓动滚动数字；`prefers-reduced-motion` 时直接设值。masthead 另含货币构成条 (composition rule/legend) 与目标净资产进度面板。
- **旭日图只显示名称** — 数值和百分比在 tooltip 中，标签只展示分类/标签名称（formatter 只返回 `p.name`）。
- **图表空态** — 所选维度全空或无可选数据时显示空态文案而非空白画布（资产/消费分布、历史净值、消费趋势均如此）。
- **弹窗关闭** — `closeModal(id)` 统一关闭；ESC 键关闭最上层弹窗；点击遮罩空白处关闭（`mousedown` 记录目标 + overlay click 判断）。
- **数据导入/导出** — `exportData()` 导出完整 `state` JSON，但剥离快照加工字段 `totalCNY`（可由 assets × currencyRates 重算，导入时 `migrateState()` 补全）；`importData()` 校验 `categories && assets` 字段后合并并走 `migrateState()`。
- **示例数据** — 资产端 `loadDemoData()`、消费端 `loadExpenseDemoData()`，均先 `showConfirm` 二次确认后覆盖当前数据。

## 开发

无构建步骤。修改后直接刷新浏览器即可生效。

## Git 提交风格

Conventional Commits，中文描述：`feat:` / `fix:` / `refactor:` / `style:` / `docs:`
