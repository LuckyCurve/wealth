# 预期年化收益率区间化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `expectedRate` 单值改为 `expectedRateMin/Max` 区间，资产列表显示利率，收益测算支持最低/最高切换。

**Architecture:** 单文件 SPA（index.html），全部改动在该文件中完成。无构建步骤，刷新浏览器即见效。

**Tech Stack:** 原生 JS + Tailwind CSS (CDN) + Apache ECharts 5 (CDN)

**Global Constraints:**
- 所有改动在 `index.html` 一个文件中完成
- 不新增外部依赖
- 旧数据自动迁移（单值 → min=max）
- 旧快照 asset 的 `expectedRate` 字段需回退兼容

---

### Task 1: 数据模型迁移 + 表单双输入框

**Files:**
- Modify: `index.html`

- [ ] **Step 1: loadState 迁移逻辑**

将旧的单值 `expectedRate` 迁移为 `expectedRateMin / expectedRateMax`：

```js
// 替换行 452-455 (ensure expectedRate exists on all assets)
state.assets.forEach(a => {
  if (a.expectedRate != null) {
    a.expectedRateMin = a.expectedRate;
    a.expectedRateMax = a.expectedRate;
  }
  if (a.expectedRateMin == null) a.expectedRateMin = 0;
  if (a.expectedRateMax == null) a.expectedRateMax = 0;
});
```

- [ ] **Step 2: 替换 HTML 中的单输入框为双输入框**

行 343-346 替换：

```html
<!-- 旧 -->
<div>
  <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">预期年化收益率 (%)</label>
  <input type="number" id="asset-expected-rate" min="0" step="1" class="w-full" placeholder="0" value="0">
</div>

<!-- 新 -->
<div>
  <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">预期年化收益率 (%)</label>
  <div class="flex items-center gap-2">
    <input type="number" id="asset-rate-min" min="0" step="0.1" class="w-full" placeholder="最低" value="0">
    <span style="color:var(--muted);">—</span>
    <input type="number" id="asset-rate-max" min="0" step="0.1" class="w-full" placeholder="最高" value="0">
  </div>
</div>
```

- [ ] **Step 3: 更新 openAssetModal 回填**

行 637 修改：

```js
// 旧
document.getElementById('asset-expected-rate').value = a.expectedRate ?? 0;

// 新
document.getElementById('asset-rate-min').value = a.expectedRateMin ?? 0;
document.getElementById('asset-rate-max').value = a.expectedRateMax ?? 0;
```

- [ ] **Step 4: 更新 saveAsset 读取和保存**

行 674 和行 692-696 修改：

```js
// 替换行 674
const expectedRateMin = parseFloat(document.getElementById('asset-rate-min').value) || 0;
const expectedRateMax = parseFloat(document.getElementById('asset-rate-max').value) || 0;

// 验证
if (expectedRateMin > expectedRateMax) {
  toast('最低利率不能高于最高利率', 'error');
  return;
}
// auto-fill: 只填了一个则同步
const finalMin = expectedRateMin || expectedRateMax;
const finalMax = expectedRateMax || expectedRateMin;
```

```js
// 替换行 692-696 中的 expectedRate 引用
if (editId) {
  const idx = state.assets.findIndex(a => a.id === editId);
  if (idx >= 0) state.assets[idx] = { ...state.assets[idx], name, amount, currency, tags, expectedRateMin: finalMin, expectedRateMax: finalMax };
} else {
  state.assets.push({ id: genId(), name, amount, currency, tags, expectedRateMin: finalMin, expectedRateMax: finalMax });
}
```

- [ ] **Step 5: 手动验证**

打开浏览器 -> 刷新 -> 编辑已有资产 -> 确认表单显示两个输入框 -> 保存 -> 检查 localStorage 数据包含 `expectedRateMin/Max`

---

### Task 2: 资产列表新增「预期年化」列

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 更新 CSS grid**

行 114 修改 `asset-row` 为 6 列布局。由于资产列表和收益测算/快照详情共用 `.asset-row`，需叠加独立类：

```css
/* 替换行 113-117 */
.asset-row {
  display: grid; grid-template-columns: 2fr 1fr 0.8fr 1.5fr 80px;
  align-items: center; padding: 14px 0; border-bottom: 1px solid #f0ece0;
  transition: background 0.15s;
}
.asset-row.grid-wide {
  grid-template-columns: 2fr 1fr 0.7fr 0.7fr 1.5fr 80px;
}
```

- [ ] **Step 2: 更新资产列表 header（行 497 附近）**

先读取 header 所在区域。在 `renderAssets()` 中找到资产列表 header 并增加「预期年化」列。

找到资产表头的 HTML（大概在 `renderAssets` 中 `sorted.map` 上方，需要定位准确行号）：

```js
// 在 renderAssets 中，header 部分（读取行 538-568 确认精确位置后修改）
```

在 `renderAssets()` 中找到类似这样的 header：

```html
<div class="asset-row grid-wide text-xs font-medium" style="color:var(--muted);border-bottom:1px solid var(--border);">
  <div onclick="toggleSort('name')" style="cursor:pointer;">名称<span id="sort-name" class="sort-indicator"></span></div>
  <div onclick="toggleSort('amount')" style="cursor:pointer;">金额<span id="sort-amount" class="sort-indicator"></span></div>
  <div onclick="toggleSort('currency')" style="cursor:pointer;">货币<span id="sort-currency" class="sort-indicator"></span></div>
  <div>预期年化</div>
  <div>标签</div>
  <div></div>
</div>
```

- [ ] **Step 3: 更新资产列表每行（行 569-587）**

```js
// 在 sorted.map 回调中，currency 和 tagHtml 之间插入
const rateLabel = a.expectedRateMin > 0 || a.expectedRateMax > 0
  ? (a.expectedRateMin === a.expectedRateMax
    ? `${a.expectedRateMin}%`
    : `${a.expectedRateMin}-${a.expectedRateMax}%`)
  : '<span style="color:var(--muted);font-size:11px;">未设置</span>';
```

```html
<!-- 行 577-586 中，在 currency div 之后、tag div 之前插入 -->
<div class="text-sm">${rateLabel}</div>
```

同时修改 `className` 从 `asset-row` 改为 `asset-row grid-wide`。

- [ ] **Step 4: 更新 toggleSort header 列**

不需要额外更新（sortBy 保持仅对 name/amount/currency 有效）。

- [ ] **Step 5: 手动验证**

刷新 -> 检查资产列表显示新列 -> 有利率的显示 `3-5%` 或 `5%` -> 无利率的显示 `未设置` -> header 点击排序正常。

---

### Task 3: 收益测算 Tab 全局模式切换

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 新增 `incomeMode` 全局变量**

在 `let incomeChart = null;`（行 1198）附近新增：

```js
let incomeMode = 'min'; // 'min' | 'max'
```

- [ ] **Step 2: 更新 calcAssetIncome 接受 mode 参数**

行 1119-1126 修改：

```js
function getAssetRate(a, mode) {
  mode = mode || incomeMode;
  const min = a.expectedRateMin ?? a.expectedRate ?? 0;
  const max = a.expectedRateMax ?? a.expectedRate ?? 0;
  return mode === 'min' ? min : max;
}

function calcAssetIncome(a, mode) {
  mode = mode || incomeMode;
  const rate = getAssetRate(a, mode);
  const cny = toCNY(a.amount, a.currency);
  const annual = cny * rate / 100;
  const monthly = annual / 12;
  const daily = annual / 365;
  return { cny, annual, monthly, daily };
}
```

- [ ] **Step 3: HTML 中新增切换开关**

在行 260（`<div id="income-empty" ...>` 之前）插入：

```html
<div id="income-mode-toggle" style="display:none;" class="flex gap-2 mb-4">
  <button id="income-mode-min" onclick="setIncomeMode('min')" class="btn-ghost" style="padding:6px 16px;font-size:12px;">使用最低</button>
  <button id="income-mode-max" onclick="setIncomeMode('max')" class="btn-ghost" style="padding:6px 16px;font-size:12px;">使用最高</button>
</div>
```

- [ ] **Step 4: 实现 setIncomeMode 函数**

在 `renderIncomeTab` 附近新增：

```js
function setIncomeMode(mode) {
  incomeMode = mode;
  // 更新按钮高亮
  document.getElementById('income-mode-min').className = mode === 'min' ? 'btn-gold' : 'btn-ghost';
  document.getElementById('income-mode-max').className = mode === 'max' ? 'btn-gold' : 'btn-ghost';
  renderIncomeTab();
}
```

- [ ] **Step 5: 更新 renderIncomeTab**

行 1128-1196 多处引用 `a.expectedRate` 改为通过 `getAssetRate(a)` / `calcAssetIncome(a)` 获取：

```js
// 行 1134: filter 条件
const assets = state.assets.filter(a => getAssetRate(a) > 0);

// 行 1149: incomes 用 calcAssetIncome(a) 已兼容 mode（内部默认 incomeMode）

// 行 1160-1162: 加权平均
const totalWeighted = assets.reduce((s, a) => {
  const cny = toCNY(a.amount, a.currency);
  return s + cny * getAssetRate(a);
}, 0);

// 行 1171: 排序
return calcAssetIncome(b).monthly - calcAssetIncome(a).monthly;

// 行 1180-1182: rate 显示改为区间格式
const hasRate = getAssetRate(a) > 0;
const rateLabel = (a.expectedRateMin > 0 || a.expectedRateMax > 0)
  ? (a.expectedRateMin === a.expectedRateMax
    ? `${a.expectedRateMin.toFixed(1)}%`
    : `${a.expectedRateMin.toFixed(1)}-${a.expectedRateMax.toFixed(1)}%`)
  : '<span style="color:var(--muted);">未设置</span>';
```

- [ ] **Step 6: 更新 renderIncomeChart**

多处 `a.expectedRate` → `getAssetRate(a)`：

```js
// 行 1215: filter
const rateAssets = state.assets.filter(a => getAssetRate() > 0);

// 行 1251: _rate
_rate: getAssetRate(a)

// 行 1296: tooltip 中的利率
🏷️ 利率: ${getAssetRate(a).toFixed(1)}%
```

- [ ] **Step 7: 切换开关在有空数据时显示**

在 `renderIncomeTab` 中，计算空状态之前显示 toggle：

```js
// 在行 1134 filter 之前（或之后判断）
const hasAnyRate = state.assets.some(a => (a.expectedRateMin ?? a.expectedRate ?? 0) > 0 || (a.expectedRateMax ?? a.expectedRate ?? 0) > 0);
document.getElementById('income-mode-toggle').style.display = hasAnyRate ? '' : 'none';
```

- [ ] **Step 8: 手动验证**

刷新 -> 切换到收益测算 Tab -> 有数据时看到切换按钮 -> 点击「使用最高」/「使用最低」-> 汇总卡片、表格、旭日图同步变化 -> 年利率列始终显示区间

---

### Task 4: 快照详情列 + resize 修复

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 快照详情增加预期年化列**

行 1017-1032 修改 `viewSnapshot`，在货币和标签之间插入：

```js
// 替换行 1017-1018 的 header
<div class="asset-row text-xs font-medium" style="color:var(--muted);border-bottom:1px solid var(--border);">
  <div>名称</div><div>金额</div><div>货币</div><div>预期年化</div><div>标签</div>
</div>
```

每个资产行中，在货币 div 后、标签 div 前插入：

```js
// 在行 1027-1032 的 asset-row 内
const snapRateMin = a.expectedRateMin ?? a.expectedRate ?? 0;
const snapRateMax = a.expectedRateMax ?? a.expectedRate ?? 0;
const snapRateLabel = snapRateMin > 0 || snapRateMax > 0
  ? (snapRateMin === snapRateMax ? `${snapRateMin}%` : `${snapRateMin}-${snapRateMax}%`)
  : '<span style="color:var(--muted);font-size:11px;">未设置</span>';
```

```html
<div class="text-sm">${snapRateLabel}</div>
```

- [ ] **Step 2: resize 监听加入 incomeChart**

行 1320-1326 修改：

```js
// 旧
window.addEventListener('resize', function() {
  if (chart) chart.resize();
  if (historyChart) historyChart.resize();
});

// 新
window.addEventListener('resize', function() {
  if (chart) chart.resize();
  if (historyChart) historyChart.resize();
  if (incomeChart) incomeChart.resize();
});
```

- [ ] **Step 3: 手动验证**

刷新 -> 查看快照详情 -> 确认显示预期年化列 -> 调整浏览器窗口大小 -> 确认旭日图自适应

---

### 全局搜索替换检查清单

实施完成后，运行以下 grep 确认无遗漏的 `expectedRate` 引用：

- `a.expectedRate`（不带 Min/Max 后缀）→ 改为 `getAssetRate(a)` 或 `a.expectedRateMin / a.expectedRateMax`
- `asset-expected-rate`（form id）→ 已替换为 `asset-rate-min / asset-rate-max`
- `.asset-row` 确保 asset list 用 `grid-wide`、income table 和 snapshot 不用
