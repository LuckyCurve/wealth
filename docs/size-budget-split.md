# 体积预算的拆分方案

预算按文件卡（`test/size-budget.test.js`）。顶格就要拆，**抬上限不算**——只抬不改视为违规。
本文只写「切在哪里、为什么切在那里、加载顺序的约束是什么」；每个文件现在多大、用掉预算百分之几，
由那条测试在跑的时候算，不写在这里（缓存可变数字只会烂）。

## 切分原则

- **按职责切，不按行数切**：拆出去的每一份都要能一句话说清它管什么；说不清就不是一个好接缝。
- **不改行为**：不改 UI、不改存档结构、不改 `localStorage` 键名、不改任何判定口径。
- **顺序即语义**：没有构建步骤，样式与脚本的先后就是级联与执行的先后。切分一律**逐字保持原顺序**——
  新的样式表按原来的字节次序加载，新的页面脚本按原来的行次序加载；跨文件只允许「运行时调用」，
  不允许「加载期取值」。
- **新文件各有一道上限**：拆完的每一份都登记进 `test/size-budget.test.js`，否则拆分就成了绕过预算的出口。

## 切分表

| 现文件 | 新文件 | 职责（一句话） | 接缝 |
| --- | --- | --- | --- |
| `logic.js` | `logic-i18n-en.js` | 英文词条表：中文原文为键的纯数据，UMD 与 `logic.js` 同一套壳 | 表尾 `};` 与 `return {` 之间；`logic.js` 里改成「Node 侧 require / 浏览器侧读全局」 |
| `styles.css` | `styles-views.css` | 报头、图表、覆盖标尺与读数卡、对比条、章节/卡片头、工具栏、月份图 | 「Masthead」注释起到「打印」注释前，整段连续 |
| `styles.css` | `styles-print.css` | 打印形态：纸面回亮色、玻璃退场、操作件与装饰层不进纸 | 「打印」注释起到文件尾（整段是唯一的 `@media print`） |
| `app-assets.js` | `app-categories.js` | 分类与标签管理（资产/消费共用）：分类卡片、分类弹窗 CRUD、长按胶囊改名 | 「分类管理」注释起至文件尾；顺带把漂在上面的 `CATEGORY CRUD` 节标题挪进来 |
| `app-settings.js` | `app-ui.js` | 全站 UI 基元：提示气泡、弹窗开关、确认框、焦点陷阱、便条、颜色取值、金额输入、id | 「UTILS」注释起至文件尾 |
| `app-expenses.js` | `app-tag-check.js` | 数据校验（缺标签补齐）：按分类捕获缺口、批量/逐条打标签，两侧共用 | 「消费数据校验」注释起至「EXPENSE CHART」注释前 |
| `app-core.js` | `app-gate.js` | 进资产页的门槛：长按抬闸、箴言抄写与校验、解锁冷却、门槛弹窗 | 「进入资产页的门槛」注释起至「台灯掠光」注释前 |
| `app-charts.js` | `app-stress.js` | 压测：情景草稿、条与印徽同步、弹窗 | 「压测」注释起至「所选标签的钱」注释前 |

## 加载顺序

- `index.html`：…… `styles.css` → `styles-views.css` → `styles-print.css` ……；
  `logic-i18n-en.js` 在 `logic.js` 之前；新增的 `app-*.js` 插在它所来自的那个文件之后
  （`app-categories.js` 紧跟 `app-assets.js`、`app-gate.js` 紧跟 `app-core.js`、`app-stress.js` 紧跟 `app-charts.js`、
  `app-ui.js` 紧跟 `app-settings.js`、`app-tag-check.js` 紧跟 `app-expenses.js`）。
- 样式顺序必须与切分前**逐字一致**：级联里「同特异性后写者胜」的既有约定（如 `.cols-*` 在 `.asset-row` 之后）
  全部跨过了文件边界，唯一还成立的理由就是这条顺序。
- 页面脚本之间只允许运行时调用。被切出去的 `const` / `let`（如 `CAT_SIDES`、`tagCheckGroups`、`_stressDraft`）
  都只在函数体里被别的文件读，没有一处是在加载期取值的。

## 不拆的：`index.html`

单页结构**没有可用的拆分通道**：

- 没有构建步骤，也就没有 include；用 `fetch` 取页面片段会同时破坏三件事——离线 / `file://` 打开、
  「全仓只有汇率一处外呼」那条断言、以及「HTML 自带完整结构」（CDN 或片段取不到时结构不能塌）。
- 把弹窗骨架改成脚本里的模板串，等于把静态文案搬出 `data-i18n` 的巡检范围（`ui-wiring` 那条按 body 切片扫
  「未挂 `data-i18n` 的中文」），漏译会重新变成只有用户看得见的问题。

所以 `index.html` 保持不拆，代价写在明面上：它的预算是下一轮要拍的板（要么允许带理由地抬，
要么先接受一次构建步骤换取 include），不在这次拆分里偷偷做掉。

## 守门改了什么

- `test/size-budget.test.js`：登记新文件的上限。
- `test/ui-wiring.test.js`：把「读 `logic.js` / `styles.css` 单份源码」改成读**整层**
  （`LOGIC_FILES` / `CSS_FILES` 按加载顺序拼）。理由：那些断言问的是「某口径在逻辑层 / 样式层里是否只有一处」，
  不是「它是否恰好落在入口文件里」；不改就会在拆分当天集体假红，改错方向（放宽断言）则会留下漏检的洞。
