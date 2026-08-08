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
  cashRatio: number;          // 现金比例 (%)：预期收益中来自股息/利息/租金等现金流的比例，0~100
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
- 资产 `cashRatio` 缺失时默认 100（全额现金，与旧版「全部收益视为收入」行为一致），越界钳制 0~100
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
- **资产列表布局** — `.asset-row.grid-wide` 列宽 `28px 1.45fr 1fr 0.55fr 1.1fr 1.25fr 1.9fr 92px`（拖拽/名称/金额/货币/金额CNY/预期年化/标签/操作），预期年化格含「· 现金 N%」后缀需 160px+ 单行；**资产列表跳过 `currency` 分类的 pill**（货币列已单独显示，避免三枚 pill 竖排把行高撑到 97px）；`.tag-pill` 已压缩（12px、padding 3px 7px 3px 5px）使两枚 pill 单行放下（行高 ~55px）。长资产名自然换行、不截断。
- **月度快照** — 同月仅保留一条，重复记录会提示「覆盖更新」。快照详情的标签颜色与资产管理列表保持一致（复用 `catColor`）。快照同时保存当时汇率 `currencyRates`。历史净值 Tab 中每条快照显示环比：首月 / 新增 / `▲▼ x.x%`（`getPrevSnapshot()` 取上一个月份）。「对比快照」弹窗（`openCompareModal`/`renderCompareTable`）按资产 id 关联两月快照逐资产 diff（新增/移除徽章），金额按各快照当时 `currencyRates` 折算 CNY；行序对齐**起始月快照的记录顺序**（拖拽调整的顺序保持一致），新增资产按结束月顺序追加在末尾；弹窗顶部为「总净值变动」hero 数字（`font-masthead`，2 位小数），表格列头用账本语汇「期初/期末」，变动列带按比例宽度迷你量条（`.cmp-bar`）；示例数据的快照资产 id 跨月稳定（与真实记录流程一致），对比才能按 id 关联出差异。
- **收入测算** — 基于 `expectedRateMin/Max` 计算 `calcAssetIncome()`（`getAssetRate()` 按 `incomeMode` `'min'|'max'` 取值），支持切换；展示年/月/日收益 + 加权平均利率。**收益拆分现金/总额**：每项资产有 `cashRatio`（现金比例 %，`getCashRatio()` 取 0~1，缺失默认 1），`calcAssetIncome()` 返回 `annual/monthly/daily`（总资产收益）与 `cashAnnual/cashMonthly`（其中现金收益 = 总收益 × 现金比例）两套口径，**安全边际因子对两套口径统一折算**；摘要双 hero（总收益 年/月/日 绿 + 现金收益 年/月/占比 金）、表格加「现金比例」「现金/月」列（表头星注覆盖两口径）、旭日图 `incomeChartMode` 支持 `'cash'|'total'` 切换（默认现金，tooltip 双口径并列）；报头「预估月收益」与「现金收益」**平齐双口径**展示（非嵌套）：`预估月收益 ¥X · 现金收益 ¥Y`；设置了 `expenseExpectation` 后，先显示「预期月消费 ¥Z」，每个口径后内联差额 `（盈余/缺口 ¥N · P%）`（`gapSuffix()`，盈余 `--verdigris` 绿、缺口 `--down` 红，金额整数千分位 + 百分比一位小数）；未设置预期不显示差额。`saveExpectation`/`clearExpectation` 需调 `renderAssets()` 刷新报头（消费页改预期后切回资产模式才会重新渲染 masthead）。**比例输入统一用「比例尺」滑块 `.scale-input`**（现金比例在资产弹窗、安全边际在收益 Tab）：轨道为墨线刻度（0/25/50/75/100%，与货币构成条同语言）、值域以 `--accent-soft` 填充段表示（**填充必须画在 `::-webkit-slider-runnable-track` 背景层栈里**，input 自身背景会被不透明轨道盖住；`--fill` 由 `syncScaleFill()` 同步）、菱形拇指呼应报头裁切标记；等宽读数 `.scale-reading`（tabular，金色）。滑块 `padding:0; border:none` 规避全局 `input,select` 样式。现金比例带「全额现金/纯增值」预设（`setCashRatioPreset`），提交钳制 0~100、空值=100。安全边际滑块 1~100，`onIncomeSafetyInput` 拖动即存并重渲染，`renderIncomeTab` 用 `activeElement` 守卫避免拖动中断同步。旭日图按资产聚合（仅统计有利率的资产）。**安全边际因子** `state.incomeSafetyFactor`（百分比，默认 100=不打折，migrateState 兜底并钳制 1~100）：`getSafetyFactor()` 取折算系数，在 `calcAssetIncome()` 内统一乘入，因此摘要/表格/旭日图/masthead 预估月收益全部折算；<100 时摘要页脚与表格下方（`#income-table-note`，表头年/月收益带 `*` 星注）提示「已按 N% 安全边际折算」；控件为参数条 `#income-safety-input`（`onIncomeSafetyInput` 输入即存并重渲染、`onIncomeSafetyBlur` 非法值回退，`renderIncomeTab` 顶部带焦点守卫同步值）。
- **目标净资产** — `netWorthTarget` 在 masthead 显示进度条（`openTargetModal`/`saveTarget`/`clearTarget`），90%+ 变强调色、达成显示「目标已达成」徽章；总资产为 0 时不显示进度避免误报。masthead 副行同时展示「N 项资产」与预估月收益（任一资产设了利率即出现）。达成预测：`predictTarget()` 取最近 6 段快照月均净值增量（按快照月份间隔归一化）反推达成月份，展示于 masthead 目标面板与目标弹窗（`renderTargetPrediction`）；数据不足 / 已达成 / 月增量 ≤ 0 返回 null，预测超 20 年显示「20 年以上」。
- **消费记录** — 排序状态 `expenseSortBy`/`expenseSortDir`；「复制」操作 `duplicateExpense(id)` 打开新增窗口预填金额/备注/标签、日期改为今天；月份筛选 `expenseMonthFilter`（下拉由 `populateExpenseMonthFilter()` 生成）；搜索框 `expenseSearch`（`oninput` 触发 `renderExpenses()`，匹配备注/日期/分类名/标签值，不区分大小写，与月份筛选叠加）；搜索交互：命中片段以「金笔划线」`mark.search-hit` 高亮（`highlightMatch()` 先 esc 转义再大小写不敏感替换，保留原文大小写）、输入框内 ×（`clearExpenseSearch()`，仅清搜索保留月份）与 ESC 清空、空态标题带搜索词并给「换个关键词」指引、合计标签双筛选时显示「月份 匹配」；空态按「完全无数据 / 搜索无结果 / 月份无记录」区分文案，「清除筛选」`clearExpenseFilters()` 重置两类筛选。趋势图按月聚合，与历史净值柱状图风格一致。
- **消费趋势** — `expenseExpectation` 设定后作为水平参考线，超线月份的柱顶 label 标红加 ▲；按钮状态化显示「设定预期 / 预期 ¥X」；透明「合计」系列不占高度、随 legend 选中实时重算。趋势下方按月列表 `viewExpenseMonth()` 查看当月明细。
- **暗色模式** — `toggleDark()` 写 `localStorage['dark-mode']`（`'1'`=暗色、`''`=亮色、`null`=未设置），通过 `document.documentElement.classList.toggle('dark')` 切换 `:root.dark` 下的 CSS 变量。`<head>` 内联脚本在渲染前设置主题：首次访问跟随系统 `prefers-color-scheme`，显式切换后以存储值为准（避免首屏闪烁）。
- **报头 (masthead) 数字动画** — `renderMasthead()` 用 `requestAnimationFrame` 做缓动滚动数字；`prefers-reduced-motion` 时直接设值。masthead 另含货币构成条 (composition rule/legend) 与目标净资产进度面板。
- **印刷账页细节** — 报头四角有裁切标记（register ticks，`.masthead::after` 八层渐变）、大数字带压印感 `text-shadow`（亮暗各一套）；卡片有纸张顶缘高光（`--card-edge`）；`.btn-gold` 为压印金属感（顶部受光 + 底部内阴影）；表格列头用 `.list-head` 双线规则（2px `--rule`）+ 0.05em 字距；货币构成条带 25/50/75% 刻度墨线（`--tick`，亮暗各一套）；图表 tooltip 统一账本卡片样式（`extraCssText` 圆角+阴影+内边距）；toast 与 `mo-badge` 同色系便条样式（亮暗各一套）；弹窗标题上带章节线（`.modal-title::before` 28×2px 金色短线）；空态有账本 SVG 图标（`.empty-state::before`，`currentColor` 跟随主题）；排序列头可键盘操作（`role="button"` + `tabindex` + Enter 触发排序）。
- **旭日图只显示名称** — 数值和百分比在 tooltip 中，标签只展示分类/标签名称（formatter 只返回 `p.name`）。
- **图表空态** — 所选维度全空或无可选数据时显示空态文案而非空白画布（资产/消费分布、历史净值、消费趋势均如此）。
- **弹窗关闭** — `closeModal(id)` 统一关闭；ESC 键关闭最上层弹窗；点击遮罩空白处关闭（`mousedown` 记录目标 + overlay click 判断）。
- **数据导入/导出** — `exportData()` 导出完整 `state` JSON，但剥离快照加工字段 `totalCNY`（可由 assets × currencyRates 重算，导入时 `migrateState()` 补全）；`importData()` 校验 `categories && assets` 字段后合并并走 `migrateState()`。
- **示例数据** — 资产端 `loadDemoData()`、消费端 `loadExpenseDemoData()`，均先 `showConfirm` 二次确认后覆盖当前数据。资产示例含现金比例演示：存款/债/理财 100%，沪深300 指数 5~8% 利率 + 20% 现金（红利型指数）。快照内资产同样带 `cashRatio`（当前资产由最新快照深拷贝而来，缺失会导致演示现金比例失效）。

## 开发

无构建步骤。修改后直接刷新浏览器即可生效。

## Git 提交风格

Conventional Commits，中文描述：`feat:` / `fix:` / `refactor:` / `style:` / `docs:`
