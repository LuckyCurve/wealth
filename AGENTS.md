# AGENTS.md — 资产管理 (Wealth Management)

单文件个人资产管理 SPA。无构建工具、无后端；核心纯逻辑抽到 `logic.js`，用内置 `node --test` 单测。直接打开 `index.html` 即可使用。

## 项目结构

```
index.html          # 全部 HTML/CSS/JS
logic.js            # 与 DOM 无关的纯函数（UMD：浏览器挂全局 / Node require）
test/               # node --test（logic.test.js 纯逻辑 + ui-wiring.test.js 接线契约 + e2e-server.test.js）
e2e/                # Playwright 端到端（app.spec.js + theme.spec.js + consistency.spec.js + fixtures.js + server.js）
playwright.config.js
package.json        # 仅 devDependency: @playwright/test（无构建步骤）
.github/workflows/  # CI：三平台 node --test + Linux Playwright E2E
AGENTS.md
.gitignore          # 忽略 .superpowers/ .pi/ node_modules/ 与测试产物
```

## 技术栈

- **Tailwind CSS (CDN) + 自定义 CSS** — 暖色古纸质主题 + 暗色模式
- **Apache ECharts 5 (CDN)** — 旭日图（资产/收入/支出结构）+ 堆叠柱状图（历史净值/支出趋势）
- **@fawazahmed0/currency-api (CDN)** — 汇率
- **Flatpickr (CDN)** — 消费表单日期选择器（中文 locale、桌面样式）
- **Noto Serif SC / IBM Plex Mono / Cormorant Garamond (Google Fonts)**

## 功能模块

两大主模式（`switchMode`），默认 **消费**：资产模式、消费模式。每个模式内各有子 Tab（`switchTab`）。顶端模式选择支持 Tab 键在资产/消费间轮流切换（见「关键发现」）。

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
  backup: {
    autoFreq: 'daily' | 'weekly' | 'off';
    lastBackup: string | null;
    lastAutoDownload: string | null;
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

## 关键发现

> 只记「会改变决策的约束与原因」。具体数值、实现步骤、UI 细节以代码与 `ui-wiring` 契约测试为准。

- **单文件结构** — `<head>`（内联暗色脚本 + Tailwind config + `<style>`）→ `<body>` → 末尾 `<script>`（全部 JS）。修改时保持。
- **单一来源** — 重复出现 ≥2 次的逻辑必须收敛到单一实现（纯函数下沉 `logic.js`，视图模板/helper 只留一处），ui-wiring 契约测试把守；改动只改单一来源处。
- **汇率口径** — `state.rates` 存「1 外币 = X CNY」（赋值处已取倒数，如 `HKD: 1/cny.hkd`）；`toCNY = amount * state.rates[cur]` 直接相乘，**不要再次取倒数**。
- **汇率刷新** — 汇率 API 有 CDN 缓存，必须 `cache: 'no-store'` 才能拿到新值；`pageshow`/`visibilitychange` 触发刷新并重绘。失败时回退已存汇率，文案与语义色由 logic.js `rateFallbackNotice()` 单一口径决定。
- **图表重绘入口** — `refreshVisibleCharts()` 供汇率刷新与主题切换共用，只重绘当前可见 Tab 的图表（隐藏 Tab 下次进入时按新主题渲染）。
- **标签关联清理** — 删除分类/标签或修改标签列表时，必须同步清理 `assets[].tags` / `expenses[].tags` 中的无效引用；`migrateState()` 承担迁移期清理。
- **平铺标签选择器** — 资产/消费录入表单与消费数据校验面板共用同一一套 chips（`tagPickerHtml`），chip 本身单一来源 `tagChipHtml`（读数区多选 picker 复用同一视觉），**禁止再造第二套**；图表维度的分类筛选下拉不受影响。
  - **分类色只出现在「已选」态**：未选中态统一 muted 字色 + 中性虚线描边。曾把分类字色用在空栏上，于是同一支 picker 里棕/绿/黄绿三色并存，暖色卡面上黄色系亮度最低，用户实测「第三个分类特别浅」（对比度虽达标，肉眼仍发白）——而 CSS 注释本意就是「虚线空栏 = 待选，实心盖印 = 已选」。
  - **已选态的「盖印」边必须强于未选空栏**：`pillColors` 的 bg/border 都是 90%+ 明度的浅 tint，与卡面只差 1.04–1.09:1，而待选空栏的中性虚线有 1.38:1——选择指示一度是**倒挂**的，用户原话「已经选中了日常但快看不出来了」。故描边走分类字色（实测 4.99–7.46:1，暗色 9.3–10.7:1），既强于空栏又满足 WCAG 非图形文字 3:1 下限；不要再改回 `--chip-border`。
  - **已选态的悬停反馈不能改字色/描边**（那会抹掉分类色），只提亮度。
- **分类标签回车录入** — 「新增标签」回车即添加；**必须带 IME `isComposing` 守卫**（中文输入法确认候选字也是回车，无守卫会在组字中提前提交并销毁输入框）；添加后整体重绘并把焦点交回同分类新输入框（可连击回车），不得再写已脱离文档的旧 input；资产/消费两侧收敛到同一实现。
- **消费数据校验** — 缺口口径（缺 key / 空值 / 指向已删标签）由 logic.js 单一函数定义，**校验条、面板、分类卡片提示条、新建分类后检测四处共用**；校验条为全局口径、不随列表筛选缩小；批量只填空缺、绝不覆盖已归类。**只对消费侧启用**（资产侧关闭，因历史快照是否随补未定）。UI 层不直接给 `tags` 赋值。
- **ECharts 单例** — 五个图表实例统一 `setOption(data, true)` 更新；`window resize` 在 `DOMContentLoaded` 顶层统一注册。
- **版式单一来源（样式同样适用「≥2 次即收敛」）** — 同类结构（章节头 / 表格 / 按钮 / 弹窗页脚与宽度 / 表单字段 / 筛选控件 / 卡片标题 / 主读数 / 文字色）共用同一套 class，布局与规格定义在 `<style>` 里；**页面不准内联重复样式**（`style="color:var(--muted)"`、`style="grid-template-columns:…"`、按钮上的 `padding`/`font-size`/`white-space` 等一律收回 CSS）。
  - 判据同代码：同一结构出现 ≥2 次就下沉单一实现。规格成「档位」（语义固定、可复用）而非随手值；**完整档位清单即 `<style>` 里的常量类**，不在此处重列（列了就会随实现漂移）。数据驱动色值（`color:${compareColor(d)}`）无法用类名表达，不在此列。
  - **表格列宽必须单一来源**：表头与数据行引用同一个 `cols-*` class 或同一个 `cols` 常量，不允许各写一遍——两边各写一串的下场是改一处忘一处、表头与内容错位。`.cols-*` 须定义在 `.asset-row` 之后（同特异性下后者胜）。
  - **规格不写进 Tailwind 类**：Tailwind 走 CDN，且 E2E 里是空壳（`window.tailwind = {}`）——写进工具类的规格既不可测、又随 CDN 抖动。关键布局用自有 CSS，顺带保证 CDN 挂掉时页面不塌。已有的 Tailwind 间距类（`mb-6`、`gap-3`）保持不动；**排版（字号/字重/字距/字体族）一律不进门**，只用 `<style>` 里的档位类（`.t-micro`/`.t-body`）与角色类。
  - **字体族必须显式写 CJK 回落**：正文是等宽字体（拉丁/数字），而它没有中文字形——不写这一层，中文会落到 monospace 的宋体兜底，小字号下笔画极细、与拉丁粗细不接，观感就是「字很浅、字重不够」。栈与档位 token 集中在 `:root, :root.dark`（与明暗无关，故意不进两套主题块，省得同一值声明两遍）。
  - **展示档必须逐级递减且互不坍缩**：主读数 > 弹窗标题 > 区块标题 > 卡片标题 > 卡片小标题。各角色用**各自的** token——曾把主读数与弹窗标题并到同一个 token，主读数被从 32px 压到 22px 而无人发现（同类一致性巡检只保证同一类内部统一，挡不住跨角色坍缩），故 `consistency.spec.js` 另有一条层级断言。
  - **文字对比度达 AA**：不再用 `opacity` 压淡承载信息的文字（分类名、pill 内 ✕ 都是真信息/真控件；实测 opacity .55 时对比掉到 1.6–2.1:1）。层级靠字重与颜色区分。
  - **`e2e/consistency.spec.js` 会自动巡检**：在真实浏览器里量同类元素的计算样式（集合大小须为 1）与「表头 vs 数据行列宽是否相等」——单测看不到「写对了 class 但 CSS 被覆盖 / 漏挂 class」，这里补上。另有一条**全站文字对比度 ≥ AA** 巡检（含亮/暗两套）与一条**展示档层级递减**断言；已知「有意淡出」的元素（未设利率的收益行、日期选择器的非本月日期）在巡检里显式豁免。
- **颜色系统** — 一律用 CSS 变量而非写死色值（变量定义见 `:root` / `:root.dark`）；`--accent-ink` 为金色文字专用；分类色 `catColor`/`expenseCatColor` 为单一来源，亮/暗分支对比度须达 AA；旭日图调色板 `CATEGORY_PALETTE`。
  - **pill 配色的 AA 由单测逐点钉住**：`CATEGORY_COLORS` 与 `pillColors()` 都在 logic.js，`test/logic.test.js` 遍历「每个基色 × 每个插值点 × 亮/暗」断言 ≥4.5:1。这条不变量曾在线下翻车——亮色分支按色相公式重算底/字，t=1 时底色被压深而字没跟着加深，实测 2.4:1，而调色板定义在 index.html 里，单测根本够不着。**插值必须锚定基色**（底色只往浅走、字色只往深走），否则整条色带会跌出 AA。
  - **`e2e/theme.spec.js` 会自动巡检**：扫全部元素的计算色，凡不在「主题允许集」里的都报出来。允许集在页面内从主题自身求值（当前模式的 CSS 变量 ∪ pill 调色板 ∪ 图表调色板），所以加变量/改分类色不需要改测试。
  - 越界分两类，**判据不同**：①**写死色值**——直接违反本条约定，现状快照在 `KNOWN_HARDCODED`（只减不增，修一处删一行）；②**浏览器 UA 默认色**——症状是「漏设样式」（如只给 `color` 的 `<button>` 会吃到灰底黑边），同样算缺陷但不进清单。
  - 两套模式的 CSS 变量必须一一对应，漏定义一个会在暗色下回落成亮色值或透明。
- **动效** — 缓动/过渡须尊重 `prefers-reduced-motion`。
- **资产表单验证** — 非 `currency` 分类的标签必选；`expectedRateMin ≤ expectedRateMax`（空值用另一值补齐）。
- **货币符号** — `HKD $` / `USD $` 区分，CNY 用 `formatCNY()` 输出 `¥`。
- **三态排序** — 资产/消费共用同一状态机（升序→降序→取消）；**仅消费列表**主键相同时按 `id` 次级排序，资产侧依赖稳定排序保持自然/拖拽顺序（有意为之，勿加 id 次级排序）。资产拖拽排序后清除 `sortBy` 恢复自然顺序。
- **键盘 Tab 切换模式** — 仅接管顶端资产/消费两个按钮（组内循环）；**不接管子 Tab 与其它分段控件**。首次 Tab 需补偿（页面未聚焦时浏览器默认先聚焦按钮，否则要按两次才切换）。循环会留在模式按钮上，需鼠标离开。
- **行内金额编辑** — 点击金额单元格可就地改；键位语义（主键盘 Enter 仅保存、小键盘 Enter/Tab 保存并跳下一行、Esc 取消）由 logic.js `inlineEditKeyAction()` 单一下沉；**提交与跳转分支都必须 `stopPropagation`**（小键盘 Enter 的 key 同为 `'Enter'`，否则冒泡会重进原行）。值非法不跳走、重回编辑态；提交后自然顺序下不整表重绘（否则会丢失正在点击的按钮），排序激活时才重绘；所有重绘路径需先收尾未提交的行内编辑（防丢值）。
- **月度快照** — 同月仅一条；快照保存当时 `currencyRates`；对比按资产 id 关联、金额按各自当时汇率折算，行序对齐起始月记录顺序。
- **堆叠柱图例记忆与下钻** — 两张堆叠柱的图例选中态须跨重绘保留（清理后以副本回灌）；点击下钻接线为单一来源，透明「合计」系列统一忽略。
- **收益测算** — 基于 `expectedRateMin/Max`；收益分**总额**与**现金**两套口径，**安全边际因子对两套口径统一折算**；仅统计设了利率的资产。预期保存/清除后刷新报头，**仅当收益 Tab 可见时**才重渲染收益内容（隐藏容器会触发 echarts 0 尺寸初始化）。
- **目标净资产** — 在 masthead 显示进度；总资产为 0 时不显示。
- **所选标签的钱 ÷ 月消费** — **落在消费趋势（依附「预期月消费」这条参考线），与收益测算无关，不得挪回收益侧**；分子按「所选标签」认定（不靠 `cashRatio`：那是收益的现金流占比，与本金能否动用无关），口径与展示下沉 logic.js；**标签语义：同一分类内为「或」（一个资产在一个分类下只带一个标签，同分类取交必然为零），不同分类之间为「且」**，用标题旁 `?` 悬停提示说明、不写正文（自绘提示只此一套，后续复用，勿再写正文式说明）；**月数一律整数、按「x 年 x 月」呈现，小数直接舍弃（保守口径：宁可少报不虚报；不足一个月只说「不足 1 个月」）**；标签引用的清理单一入口（迁移 + 分类 CRUD，仅资产侧）；**不设目标值、不造概念词**（用户只要「选标签 + 算式」，UI 只呈现除法与读数）。
- **读数卡分母（月消费）可自定** — 默认取全局「预期月消费」，**改动只作用于这张卡、绝不回填全局**（目的：按更保守的月消费看能撑多久）；分母取值与「是否自定」同一判定下沉 logic.js，自定时分母名须换名（否则与旁边的覆盖标尺/进度卡看着像同一个数）；与全局值相同的数按默认存（否则日后改全局预期时本卡会默默钉住旧值）；分母与标签同处一个弹窗，全局预期未设仍整卡不显示（卡内自定值不放行）。
- **收益覆盖标尺** — 度量「月收益 ÷ 预期月消费」，公式与读数直接呈现，UI 不引入自造概念词。分子口径可切换（总收益宽松 / 现金严格）；覆盖率与盈余/缺口口径由 logic.js 单一函数定义，内联脚本不得重写算式；骨架静态存在、只同步宽度文案。
- **消费记录** — 月份/标签/搜索三重筛选叠加；标签筛选为单下拉分组（分类作不可选分组头），状态同步单一入口，分类被删/标签改名后回落「全部标签」；搜索高亮须先转义再替换（防注入）；空态区分「无数据/搜索无结果/月份无记录」。
- **消费趋势** — 预期月消费作为参考线，超线月份显著标记；可按标签下钻展开当月明细；「本月已花 ÷ 预期月消费」预算卡同依附这条参考线（与「所选标签读数卡」先近后远，仅趋势页一处呈现，不得回潮消费记录页）。
  - **不用时间进度做对照基准**：消费沿时间并不均匀（房租这类大额固定支出在月初入账），「比时间进度多花/少花」几乎只由那笔支出的入账日决定，不携带「是否花超了」的信息，还会诱导用户把正常支出当异常。只报两个不依赖均匀假设、直接可决策的数：**剩余预算**与**日均可用**（剩余 ÷ 余下天数）。
  - 余下天数按**今天算整天**；打平算不超（与收益差额口径同精神）；超支时剩余归零、不呈现负的日均，只报超出额；月末推算不做（月初噪声大，违背保守口径）。
- **暗色模式** — 切换入口唯一在设置弹窗；`<head>` 内联脚本在渲染前定好初始主题（跟随系统，显式切换后以存储为准），避免首屏闪烁。
- **设置弹窗** — 导入/导出、外观、自动备份的唯一入口。
- **统一提示便条** — 全站唯一的瞬时反馈出口（`toast` / `#toast-area`），**禁止第二套通道**；三种语义色（success/error/info）；同文案同类型且未退场时只重置计时不堆叠。
- **图表空态与转义** — 所选维度无数据时显示空态而非空白画布；旭日图标签只显示名称，数值/占比在 tooltip；**tooltip 中插值的用户输入（资产名/标签等）必须转义，防存储型 XSS**。
- **弹窗** — `openModal`/`closeModal` 成对；ESC 关最上层；点遮罩空白处关闭。
- **数据导入/导出** — 导出剥离快照加工字段 `totalCNY`；导入校验必要字段后走 `migrateState()`。
- **数据防丢备份** — 两层：①启动后按频率静默自动下载（仅在有数据时），导出前须 `await` 同一笔汇率拉取完成，避免写入过期汇率；②距上次备份超期时温和提醒。是否该备份、超期天数、文案等决策在 logic.js（可单测），index.html 只留 DOM 副作用。
- **示例数据** — 资产/消费各有示例加载，覆盖前二次确认；示例含现金比例演示。

## 开发

无构建步骤，改完刷新浏览器生效。

### TDD（测试先行）

红-绿-重构：**先写失败测试 → 最小实现 → 重构**，不允许先改实现再补测试。

1. 纯逻辑加到 `test/logic.test.js`；DOM 接线/单一来源/旧入口契约加到 `test/ui-wiring.test.js`。测试即需求说明书。
2. 新增测试必须先失败（red），失败原因须与预期一致。
3. 只改到转绿，不夹带无关改动；绿灯下重构，每步重跑 `node --test`。
4. 一个独立问题一个 commit（Conventional Commits，中文描述），提交前 `node --test` 全绿，独立 push。

单文件 SPA 没有组件引用可查，`onclick`/`innerHTML` 接线就是契约本身——视图层改动优先在 `ui-wiring.test.js` 用文本断言把守「单一来源」与「旧入口不回潮」。

### 文档与代码的边界（防漂移）

**AGENTS.md 只写「约束与为什么」——即会改变决策的信息；不写具体数值、实现步骤、UI 细节。** 后者由代码与 `ui-wiring` 契约测试承担，写进文档只会随实现漂移并产生误导。新增约定时，若它既不能被测试守住、又不是「为什么」，就不要写进来。

## 单元测试

核心纯逻辑（换算、收益、迁移、日期、转义、颜色等）抽到 `logic.js`，UMD 双端复用：浏览器由 `<script src="logic.js">` 挂到全局，Node 下 `require`。

- 运行：`node --test`（零依赖，内置 `node:test` / `node:assert`）。
- `test/logic.test.js` — 纯函数单测。
- `test/ui-wiring.test.js` — 对 `index.html` 的文本契约断言，把守「单一来源 / 旧入口不回潮 / 关键接线」；完整清单见文件内 `describe` 标题。
- 依赖全局 `state` / `incomeMode` 的函数，测试中经 `globalThis` 注入。
- 改动纯逻辑时同步更新 `logic.js` 与单测。

## 端到端测试（Playwright）

真实浏览器里跑一遍：`npm run test:e2e`（`npx playwright test`）。跑在 `e2e/`，与 `node --test` 的 `test/` 完全分开（后者只拾取 `test/*.test.js`）。CI 上 Linux + chromium 单矩阵即可，E2E 验证的是应用行为、与 OS 无关。

- **不访问外网**：汇率 / echarts / tailwind / flatpickr / 字体全部 `page.route` stub（见 `e2e/fixtures.js`）。要测的是应用自身行为，不是 CDN 可用性；断网也能跑。
- **Tailwind 在 E2E 里是空壳**：`window.tailwind = {}`，所以工具类（`flex`/`gap-3`/`grid-cols-2`）在 E2E 里不生效——截图不能用来验收 Tailwind 布局。这也是「版式规格必须写在自有 CSS 里」的原因之一（见「版式单一来源」）。
- **版式巡检（`consistency.spec.js`）**：同类元素的计算样式集合须为 1，表头与数据行列宽须相等，同档字号/字重唯一，展示档逐级递减。新增同类结构时不必改测试（判据从页面自身求值）；它拓的是「写对 class 但被覆盖 / 漏挂 class」这类单测看不见的漏洞。另有一条**全站文字对比度 ≥ AA** 巡检（亮/暗两套；「有意淡出」的元素显式豁免）。
- **route 后注册者优先**：兜底「拦掉一切外网」必须先注册，具体 CDN 替身后注册才能覆盖它。次序写反会让所有替身失效且不报错，只表现为一串莫名失败。
- **先关动效再断言数字**：masthead 净资产是计数动画，等它收敛会让每个数字断言吃满超时。`fixtures` 里统一 `emulateMedia({ reducedMotion: 'reduce' })`。
- **E2E 里禁止 `waitForTimeout` 睡眠**：`switchTab` 的 display 翻转、`setTheme` 的 classList 翻转都是同步的，用可见断言即可到位；固定等待会让主题巡检这类全 Tab 遍历的用例凭空多吃数秒（曾占全套时长的 1/3）。确需等待异步渲染时用 `expect.poll`。
- **读内存态 vs 读存档**：`migrateState()` 只修内存态、不回写 localStorage。验证「已落盘」读 localStorage，验证「迁移/兜底已生效」读 `state`。
- **seed 只在首次导航生效**：`addInitScript` 对每次导航（含 reload）都会重跑，若无条件覆盖，reload 会把存档洗回种子值 —— 持久化用例会「永远绿」（假通过）。标记用 sessionStorage（同一标签页跨 reload 存活、每个用例独立）。
- **静态服务器的健康检查要验明正身**：`webServer.url` 指向 `/__e2e_health__`（仅本服务器提供）。`reuseExistingServer` 只看端口是否响应，固定端口被别的服务占用时会静默连错，症状是一堆难以理解的失败。
- 静态服务器 `e2e/server.js` 是零依赖的、只服务本项目目录；不用 `file://`，因为 localStorage 在 file origin 下不可靠。
- TDD 同样适用：E2E 是发现「能打开但点不动」这类 bug 的地方（如原生 `step` 校验静默拦截提交），先写失败用例再改实现。

## Git 提交风格

Conventional Commits，中文描述：`feat:` / `fix:` / `refactor:` / `style:` / `docs:`
