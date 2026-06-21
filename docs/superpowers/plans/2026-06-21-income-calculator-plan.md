# 收益测算功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在单页资产管理 SPA 中新增「收益测算」Tab，支持按资产设置预期年化收益率，并计算年/月/日收益。

**Architecture:** 所有改动均在 `index.html` 单文件内。Asset 模型新增 `expectedRate` 字段，资产表单增加输入，新增第5个 Tab 展示汇总卡片 + 明细表格 + 柱状图。

**Tech Stack:** 原生 JS + ECharts 5 (已有) — 无构建工具、无测试框架

## Global Constraints

- 所有代码在 `index.html` 单文件内（HTML → CSS → JS 顺序）
- 不引入新的外部依赖
- 不修改现有 Tab 的渲染逻辑
- 存量资产 `expectedRate` 自动补 0
- 使用已有的 `toCNY()`、`formatCNY()`、`CATEGORY_PALETTE`、`genId()` 工具
- `switchTab` 新增分支，不修改已有分支

---

### Task 1: 数据模型 — 添加 expectedRate 字段及迁移

**Files:**
- Modify: `index.html`（`loadState` 函数 + `saveAsset` 函数）

**Interfaces:**
- Consumes: `state.assets` 数组，每项为 Asset 对象
- Produces: 所有 Asset 对象均包含 `expectedRate: number`（默认 0）

- [ ] **Step 1: 在 `loadState()` 中添加存量迁移**

在 `index.html` 约第 396 行，`state.assets.forEach(a => { ... })` 迁移块之后添加：

```javascript
// ensure expectedRate exists on all assets
state.assets.forEach(a => {
  if (a.expectedRate == null) a.expectedRate = 0;
});
```

- [ ] **Step 2: 在 `saveAsset()` 中保存 expectedRate**

在 `index.html` 约第 616 行，`saveAsset` 函数内，`const tags = {};` 之前添加读取：

```javascript
const expectedRate = parseFloat(document.getElementById('asset-expected-rate').value) || 0;
```

在第 638-640 行的对象合并处添加字段：

```javascript
if (editId) {
    const idx = state.assets.findIndex(a => a.id === editId);
    if (idx >= 0) state.assets[idx] = { ...state.assets[idx], name, amount, currency, tags, expectedRate };
} else {
    state.assets.push({ id: genId(), name, amount, currency, tags, expectedRate });
}
```

- [ ] **Step 3: 验证**

打开浏览器，在 DevTools 中检查现有资产对象应包含 `expectedRate: 0`。新建资产时 `expectedRate` 应为输入值，默认为 0。

---

### Task 2: 资产表单 — 添加预期年利率输入字段

**Files:**
- Modify: `index.html`（HTML 表单部分 + `openAssetModal` 函数）

**Interfaces:**
- Consumes: `asset.expectedRate` 用于回填
- Produces: 资产表单新增输入框，id 为 `asset-expected-rate`

- [ ] **Step 1: 在表单 HTML 中添加预期年利率输入**

在 `index.html` 约第 299 行，`asset-currency` select 的 `</div>` 闭合后添加：

```html
<div>
  <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">预期年利率 (%)</label>
  <input type="number" id="asset-expected-rate" min="0" step="0.1" class="w-full" placeholder="如：5">
</div>
```

- [ ] **Step 2: 在 `openAssetModal()` 中回填已有值**

在 `index.html` 约第 583 行，`document.getElementById('asset-currency').value = a.currency;` 之后添加：

```javascript
document.getElementById('asset-expected-rate').value = a.expectedRate || 0;
```

- [ ] **Step 3: 验证**

打开资产表单，应看到「预期年利率(%)」输入框。编辑已有资产，应回填之前保存的值。

---

### Task 3: 新增「收益测算」Tab 按钮和页面骨架

**Files:**
- Modify: `index.html`（Tab 按钮栏 + Tab 内容区域）

**Interfaces:**
- Consumes: `switchTab` 函数的 tab 名称 `'income'`
- Produces: 第 5 个 Tab 的按钮和空的 section 容器

- [ ] **Step 1: 在 Tab 按钮栏添加「收益测算」按钮**

在 `index.html` 约第 164 行，在历史净值按钮之后添加：

```html
<button class="tab-btn" data-tab="income" onclick="switchTab('income')">收益测算</button>
```

- [ ] **Step 2: 在 `<main>` 内添加收益测算 section**

在 `index.html` 约第 251 行（`</section>` 闭合历史净值 tab 后），在 `</main>` 之前添加：

```html
<!-- Income Tab -->
<section id="tab-income" style="display:none;">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h2 class="font-display text-lg font-bold">收益测算</h2>
      <p class="text-sm mt-1" style="color: var(--muted);">根据资产金额和预期年利率，计算预期收益</p>
    </div>
  </div>
  <div id="income-empty" class="card text-center py-16">
    <p style="color: var(--muted);">⚠ 尚未设置预期利率，请先在「资产管理」中编辑资产并填写预期年利率</p>
  </div>
  <div id="income-summary" class="card mb-6" style="display:none;">
    <div class="grid grid-cols-3 gap-6 text-center">
      <div>
        <p class="text-xs font-medium mb-1" style="color:var(--muted);">年收益</p>
        <p id="income-annual" class="font-display text-2xl font-bold" style="color:var(--accent);">¥0</p>
      </div>
      <div>
        <p class="text-xs font-medium mb-1" style="color:var(--muted);">月收益</p>
        <p id="income-monthly" class="font-display text-2xl font-bold" style="color:var(--accent);">¥0</p>
      </div>
      <div>
        <p class="text-xs font-medium mb-1" style="color:var(--muted);">日收益</p>
        <p id="income-daily" class="font-display text-2xl font-bold" style="color:var(--accent);">¥0</p>
      </div>
    </div>
    <p id="income-summary-footer" class="text-xs text-center mt-3" style="color:var(--muted);"></p>
  </div>
  <div id="income-table-container" class="card" style="display:none;">
    <div id="income-rows"></div>
  </div>
  <div id="income-chart-container" class="card mt-6" style="display:none;">
    <div id="income-chart" style="width:100%; height:320px;"></div>
  </div>
</section>
```

- [ ] **Step 3: 在 `switchTab()` 中添加 branch**

在 `index.html` 约第 476 行，`if (tab === 'history')` 块之后添加：

```javascript
if (tab === 'income') {
    setTimeout(() => renderIncomeTab(), 100);
}
```

同时添加 `tab-income` 的 display 控制。找到 `document.getElementById('tab-history')` 一行，在其后添加：

```javascript
document.getElementById('tab-income').style.display = tab === 'income' ? '' : 'none';
```

- [ ] **Step 4: 验证**

切换到「收益测算」Tab，应看到空的页面骨架，显示 "⚠ 尚未设置预期利率" 提示。

---

### Task 4: 收益测算渲染逻辑 — 计算、表格、图表

**Files:**
- Modify: `index.html`（JS 部分，约第 1060 行之后添加新函数）

**Interfaces:**
- Produces: `renderIncomeTab()` 渲染汇总卡片 + 表格 + 图表
- Consumes: `state.assets`、`state.rates`、`toCNY()`、`formatCNY()`、`CATEGORY_PALETTE`

- [ ] **Step 1: 实现 `renderIncomeTab()` 函数**

在 `index.html` 约第 1060 行（`renderHistoryTab` 函数之后），添加核心渲染函数：

```javascript
// ========== INCOME CALCULATOR ==========
function calcAssetIncome(a) {
  const cny = toCNY(a.amount, a.currency);
  const rate = a.expectedRate || 0;
  const annual = cny * rate / 100;
  const monthly = annual / 12;
  const daily = annual / 365;
  return { cny, annual, monthly, daily };
}

function renderIncomeTab() {
  const empty = document.getElementById('income-empty');
  const summary = document.getElementById('income-summary');
  const table = document.getElementById('income-table-container');
  const chartContainer = document.getElementById('income-chart-container');

  const assets = state.assets.filter(a => a.expectedRate > 0);

  if (assets.length === 0) {
    empty.style.display = '';
    summary.style.display = 'none';
    table.style.display = 'none';
    chartContainer.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  summary.style.display = '';
  table.style.display = '';
  chartContainer.style.display = assets.length > 0 ? '' : 'none';

  // --- Summary ---
  const incomes = state.assets.map(calcAssetIncome);
  const totalAnnual = incomes.filter(i => i.annual > 0).reduce((s, i) => s + i.annual, 0);
  const totalMonthly = totalAnnual / 12;
  const totalDaily = totalAnnual / 365;
  const totalCNY = state.assets.reduce((s, a) => s + toCNY(a.amount, a.currency), 0);

  document.getElementById('income-annual').textContent = formatCNY(totalAnnual);
  document.getElementById('income-monthly').textContent = formatCNY(totalMonthly);
  document.getElementById('income-daily').textContent = formatCNY(totalDaily);

  // Weighted average rate
  const totalWeighted = assets.reduce((s, a) => {
    const cny = toCNY(a.amount, a.currency);
    return s + cny * a.expectedRate;
  }, 0);
  const totalAssetCNY = assets.reduce((s, a) => s + toCNY(a.amount, a.currency), 0);
  const avgRate = totalAssetCNY > 0 ? (totalWeighted / totalAssetCNY).toFixed(2) : '0.00';
  document.getElementById('income-summary-footer').textContent =
    `加权平均利率 ${avgRate}% · 总资产 ${formatCNY(totalCNY)}`;

  // --- Table ---
  const sorted = [...state.assets].sort((a, b) => {
    return calcAssetIncome(b).monthly - calcAssetIncome(a).monthly;
  });
  const rows = document.getElementById('income-rows');
  rows.innerHTML = [
    '<div class="asset-row text-xs font-medium" style="color:var(--muted);border-bottom:1px solid var(--border);">',
    '  <div>名称</div><div>金额 (CNY)</div><div>年利率</div><div>年收益</div><div>月收益</div>',
    '</div>',
    ...sorted.map(a => {
      const inc = calcAssetIncome(a);
      const hasRate = a.expectedRate > 0;
      const style = hasRate ? '' : ' style="opacity:0.4;"';
      const rateLabel = hasRate ? a.expectedRate.toFixed(2) + '%' : '<span style="color:var(--muted);">未设置</span>';
      return `<div class="asset-row"${style}>
        <div class="font-medium text-sm">${esc(a.name)}</div>
        <div class="font-mono text-sm">${formatCNY(inc.cny)}</div>
        <div class="text-sm">${rateLabel}</div>
        <div class="font-mono text-sm">${hasRate ? formatCNY(inc.annual) : '-'}</div>
        <div class="font-mono text-sm">${hasRate ? formatCNY(inc.monthly) : '-'}</div>
      </div>`;
    }).join('')
  ].join('');

  // --- Chart ---
  renderIncomeChart(assets);
}
```

- [ ] **Step 2: 实现 `renderIncomeChart()` 函数**

在 `renderIncomeTab()` 之后添加：

```javascript
let incomeChart = null;

function renderIncomeChart(assets) {
  const el = document.getElementById('income-chart');
  if (assets.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';

  if (!incomeChart) {
    incomeChart = echarts.init(el);
  }

  const sorted = [...assets].sort((a, b) => calcAssetIncome(b).monthly - calcAssetIncome(a).monthly);
  const names = sorted.map(a => a.name);
  const values = sorted.map(a => calcAssetIncome(a).monthly);

  incomeChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: function(params) {
        const p = params[0];
        const a = sorted[p.dataIndex];
        const inc = calcAssetIncome(a);
        return `<b>${esc(a.name)}</b><br/>月收益: ${formatCNY(inc.monthly)}<br/>年收益: ${formatCNY(inc.annual)}`;
      }
    },
    grid: { left: '12%', right: '4%', bottom: '12%', top: '6%' },
    xAxis: {
      type: 'category', data: names,
      axisLabel: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, formatter: v => formatCNY(v) }
    },
    series: [{
      type: 'bar', data: values,
      itemStyle: {
        color: function(p) {
          const pal = CATEGORY_PALETTE[p.dataIndex % CATEGORY_PALETTE.length];
          return pal.base;
        }
      }
    }]
  }, true);
}
```

- [ ] **Step 3: 将 `incomeChart` 加入全局 resize 监听**

在 `index.html` 约第 829 行，`window.addEventListener('resize', ...)` 中添加：

```javascript
if (incomeChart) incomeChart.resize();
```

- [ ] **Step 4: 在 `renderAll()` 中不自动渲染 income（由 switchTab 触发）**

确认 `renderAll()` 中不需要调用 `renderIncomeTab()` — 它只由 `switchTab('income')` 触发。无需修改。

- [ ] **Step 5: 验证**

打开浏览器：
1. 新建资产时设置 5% 预期利率，保存
2. 切换到「收益测算」Tab
3. 应看到：汇总卡片（年/月/日收益）、明细表格（按收益排序）、柱状图
4. 新建一个不设利率的资产（默认 0%），表格中应灰色显示并标记"未设置"，汇总和图表不统计它
5. 将所有资产利率设为 0，Tab 应显示空状态引导文字
