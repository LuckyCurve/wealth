# AGENTS.md — 资产管理 (Wealth Management)

单文件个人资产管理 SPA。无构建工具、无测试、无后端。直接打开 `index.html` 即可使用。

## 项目结构

```
index.html   # 全部 HTML/CSS/JS (~2820 行)
AGENTS.md
.gitignore   # 忽略 .superpowers/ 和 .pi/
```

## 技术栈

| 技术 | 用途 |
|---|---|
| Tailwind CSS (CDN) + 自定义 CSS | 暖色调古纸质 (parchment ledger) 主题 + 暗色模式 |
| Apache ECharts 5 (CDN) | 旭日图 (资产/收入/支出结构) + 堆叠柱状图 (历史净值/支出趋势) |
| @fawazahmed0/currency-api (CDN) | 汇率 (`1 CNY = ? HKD/USD`，见下方换算说明) |
| Noto Serif SC / IBM Plex Mono / Cormorant Garamond (Google Fonts) | 标题 / 正文+数字 / 报头 (masthead) 装饰 |

## 功能模块

两大主模式 (`switchMode`)，默认进入 **消费** 模式：

- **资产模式** (`currentMode='assets'`)：资产清单、资产分类、旭日图、历史快照、收入预估
- **消费模式** (`currentMode='expenses'`)：消费记录、消费分类、消费旭日图、支出趋势

每个模式内各自又有子 Tab (`switchTab`)。

## 核心数据模型 (localStorage key: `wealth-manager-data`)

```typescript
interface AppState {
  categories: Category[];        // 资产分类 [{ id, name, builtin, tags[] }]
  assets: Asset[];               // 资产 (见下)
  snapshots: Snapshot[];         // 月度快照 (见下)
  expenseCategories: Category[]; // 消费分类，结构与 categories 相同，独立存储
  expenses: Expense[];           // 消费记录 (见下)
  rates: { CNY: 1, HKD: number, USD: number, fetchedAt: string | null };
}

interface Asset {
  id: string;                 // genId() = Date.now()-前缀
  name: string;
  amount: number;
  currency: 'CNY' | 'HKD' | 'USD';
  tags: { [catId: string]: string };  // 含自动同步的 tags.currency
  expectedRateMin: number;    // 预期年利率下限 (%)，0 表示未设置
  expectedRateMax: number;    // 预期年利率上限 (%)
  // 旧版曾用单一 expectedRate，loadState() 会迁移为 Min/Max 并 delete expectedRate
}

interface Snapshot {
  month: string;              // 'YYYY-MM'，同月仅保留一条
  note: string;
  totalCNY: number;
  currencyRates: { ...state.rates };  // 快照当时的汇率
  assets: Asset[];            // 深拷贝
  updatedAt: string;          // ISO 时间戳
  // 旧版用 { id, date }，loadState() 迁移为月度格式
}

interface Expense {
  id: string;
  date: string;               // 'YYYY-MM-DD'
  amount: number;             // CNY
  note: string;
  tags: { [catId: string]: string };  // 引用 expenseCategories
}
```

**内置分类 `currency`**: `{ id:'currency', name:'货币类型', builtin:true, tags:['CNY','HKD','USD'] }` — 首次加载自动创建，不可编辑/删除。资产的 `tags.currency` 由 `syncCurrencyTag()` 自动同步 `currency` 字段。

**消费分类** 与资产分类完全独立（`expenseCategories` / `expenses`），颜色映射走 `expenseCatColor()` 而非 `catColor()`。旧版曾内置 `expense-type` 分类，`loadState()` 会过滤移除并清理孤立标签引用。

## 关键发现

- **所有代码在单文件中** — 结构顺序：`<head>` (Tailwind config + `<style>` 自定义 CSS 变量) → `<body>` (HTML) → 末尾 `<script>` (全部 JS)。修改时保持此结构。
- **汇率字段含义已反转** — `state.rates` 存的是「1 外币 = X CNY」（`HKD: 1/cny.hkd`，`USD: 1/cny.usd`），所以 `toCNY(amount, cur) = amount * state.rates[cur]` 直接相乘即可。AGENTS 旧版描述的「取倒数」已体现在赋值处，调用方无需再处理。
- **标签关联清理** — 删除分类/标签或编辑分类标签列表时，必须同步清理 `assets[].tags`（资产）或 `expenses[].tags`（消费）中的无效引用。`loadState()` 已含迁移期清理逻辑。
- **ECharts 全局单例** — 五个实例变量：`chart`(资产旭日图)、`historyChart`(历史净值堆叠柱)、`incomeChart`(收入旭日图)、`expenseChart`(消费旭日图)、`expenseTrendChart`(支出趋势堆叠柱)。均用 `setOption(data, true)` 更新，`window resize` 时统一 resize。`historyChartMode` 支持 `'value' | 'percent'`，`expenseTrendMode` 同理。
- **颜色系统** — CSS 变量 (`--bg`, `--fg`, `--muted`, `--accent`, `--verdigris` 等) 控制主题；`CATEGORY_COLORS` (10 色 `{bg,fg,border}` 数组) 为分类基础色；`catColor(catId, tagName)` / `expenseCatColor(...)` 在同分类内按标签索引对 HSL 亮度做插值区分；旭日图另用 `CATEGORY_PALETTE` (10 色 `{base, shades[]}` 数组)。
- **资产表单验证** — 非 `currency` 分类在每个下拉选择器中均 `required`，未选则报错；`expectedRateMin` 不能大于 `expectedRateMax`（空值会自动用另一值补齐）。
- **美元/港币货币符号** — 代码中用 `HKD $` / `USD $` 区分，CNY 用 `formatCNY()` 输出 `¥`。
- **月度快照** — 同月仅保留一条，重复记录会提示「覆盖更新」。快照详情的标签颜色与资产管理列表保持一致（复用 `catColor`）。快照同时保存当时汇率 `currencyRates`。
- **收入预估** — 基于 `expectedRateMin/Max` 计算 `calcAssetIncome()`，支持 `incomeMode` `'min'|'max'` 切换；展示年/月/日收益 + 加权平均利率。旭日图按资产聚合。
- **消费记录** — 排序状态 `expenseSortBy`/`expenseSortDir`，主键相同时按 `id`（即创建顺序，Date.now 前缀）次级排序。趋势图按月聚合，与历史净值柱状图风格一致。
- **暗色模式** — `toggleDark()` 写 `localStorage['dark-mode']`，通过 `document.documentElement.classList.toggle('dark')` 切换 `:root.dark` 下的 CSS 变量，按钮图标 `☀`/`☾`。
- **报头 (masthead) 数字动画** — `renderMasthead()` 用 `requestAnimationFrame` 做缓动滚动数字；`prefers-reduced-motion` 时直接设值。
- **旭日图只显示名称** — 数值和百分比在 tooltip 中，标签只展示分类/标签名称（formatter 只返回 `p.name`）。
- **数据导入/导出** — `exportData()` 导出完整 `state` JSON 文件，`importData()` 校验 `categories && assets` 字段后合并，并为旧导出补全 `expenseCategories`/`expenses`。
- **示例数据** — 资产端 `loadDemoData()`、消费端 `loadExpenseDemoData()`，均先 `showConfirm` 二次确认后覆盖当前数据。

## 开发

无构建步骤。修改后直接刷新浏览器即可生效。

## Git 提交风格

Conventional Commits，中文描述：`feat:` / `fix:` / `refactor:` / `docs:`
