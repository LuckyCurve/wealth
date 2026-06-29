# 消费记账功能 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在资产管理 SPA 中添加并列的消费记账功能，独立分类体系、消费记录 CRUD、旭日图+月份选择器、消费趋势柱状图。

**Architecture:** 单文件 SPA，模式切换器控制资产/消费两套 UI，消费有独立数据模型（expenseCategories, expenses）和 4 个 Tab，与资产共享 localStorage key。

**Tech Stack:** 纯 HTML/CSS/JS，Tailwind CSS CDN，ECharts 5 CDN，无构建工具。

## Global Constraints

- 单文件 `index.html`，所有代码内嵌
- 资产和消费数据均在同一个 localStorage key: `wealth-manager-data`
- 资产的「导入示例数据」按钮只初始化资产侧数据；消费的「导入示例数据」按钮只初始化消费侧数据
- 消费标签颜色复用 `CATEGORY_COLORS` 10 色数组 + HSL 深浅算法
- 旭日图使用 `CATEGORY_PALETTE` 10 色数组
- 消费金额统一 CNY，不涉及多币种和汇率
- 暗色模式必须兼容（CSS 变量驱动）

---

### Task 1: HTML — 模式切换器 + Tab 栏重构

**Files:**
- Modify: `index.html:161-171` (Tabs 区域)

**Interfaces:**
- Produces: `switchMode('assets' | 'expenses')` 调用点，两个 Tab 容器 `#tabs-assets` / `#tabs-expenses`

在 Header 和 Tabs 之间插入模式切换器，将现有一个 Tab 栏改造为两个并列 Tab 栏（资产/消费各一套）。

- [ ] **Step 1: 在 Header 之后、Tabs 之前插入模式切换器**

将 `<!-- Tabs -->` (line 161) 替换为模式切换器 + 两组 Tab 容器。

Old text:
```html
<!-- Tabs -->
<div class="max-w-6xl mx-auto px-6">
  <div class="flex gap-1 border-b" style="border-color: var(--border);">
    <button class="tab-btn active" data-tab="assets" onclick="switchTab('assets')">资产管理</button>
    <button class="tab-btn" data-tab="categories" onclick="switchTab('categories')">标签分类</button>
    <button class="tab-btn" data-tab="chart" onclick="switchTab('chart')">资产分布</button>
    <button class="tab-btn" data-tab="history" onclick="switchTab('history')">历史净值</button>
    <button class="tab-btn" data-tab="income" onclick="switchTab('income')">收益测算</button>
  </div>
</div>
```

New text:
```html
<!-- Mode Switcher -->
<div class="max-w-6xl mx-auto px-6 pt-4">
  <div class="flex justify-center">
    <div class="flex rounded-lg p-0.5 gap-0.5" style="background:var(--border);">
      <button id="mode-assets" onclick="switchMode('assets')" class="btn-gold px-4 py-1.5 text-sm rounded-md" style="padding:6px 24px;">资产管理</button>
      <button id="mode-expenses" onclick="switchMode('expenses')" class="btn-ghost px-4 py-1.5 text-sm rounded-md" style="padding:6px 24px;">消费记账</button>
    </div>
  </div>
</div>

<!-- Tabs: Assets -->
<div id="tabs-assets" class="max-w-6xl mx-auto px-6 pt-2">
  <div class="flex gap-1 border-b" style="border-color: var(--border);">
    <button class="tab-btn active" data-tab="assets" onclick="switchTab('assets')">资产管理</button>
    <button class="tab-btn" data-tab="categories" onclick="switchTab('categories')">标签分类</button>
    <button class="tab-btn" data-tab="chart" onclick="switchTab('chart')">资产分布</button>
    <button class="tab-btn" data-tab="history" onclick="switchTab('history')">历史净值</button>
    <button class="tab-btn" data-tab="income" onclick="switchTab('income')">收益测算</button>
  </div>
</div>

<!-- Tabs: Expenses -->
<div id="tabs-expenses" class="max-w-6xl mx-auto px-6 pt-2" style="display:none;">
  <div class="flex gap-1 border-b" style="border-color: var(--border);">
    <button class="tab-btn active" data-tab="expenses" onclick="switchTab('expenses')">消费记录</button>
    <button class="tab-btn" data-tab="expense-categories" onclick="switchTab('expense-categories')">标签分类</button>
    <button class="tab-btn" data-tab="expense-chart" onclick="switchTab('expense-chart')">消费分布</button>
    <button class="tab-btn" data-tab="expense-trend" onclick="switchTab('expense-trend')">消费趋势</button>
  </div>
</div>
```

- [ ] **Step 2: 保存并刷新浏览器，确认旧 Tab 正常显示**

### Task 2: HTML — Main Content 区域包裹 + 消费内容区

**Files:**
- Modify: `index.html:172-306` (Main Content 区域)

**Interfaces:**
- Produces: `<div id="content-assets">` 包裹现有资产内容区，`<div id="content-expenses">` 消费内容区，及各 section id

- [ ] **Step 1: 在 `<main>` 内部包裹现有资产 section**

将 `<main class="max-w-6xl mx-auto px-6 py-8">` 内的 5 个资产 section 用 `<div id="content-assets">` 包裹，并在后面追加 `<div id="content-expenses" style="display:none;">` 包含消费 4 个 section。

Replace `<main class="max-w-6xl mx-auto px-6 py-8">` through `</main>` (lines 172-306)：

Old opening:
```html
<main class="max-w-6xl mx-auto px-6 py-8">
```

Keep `<main>` but wrap existing sections:

```html
<main class="max-w-6xl mx-auto px-6 py-8">

  <!-- ====== ASSETS CONTENT ====== -->
  <div id="content-assets">
```

Then after the last `</section>` inside main (before `</main>`), close the assets wrapper and add expense sections:

Old closing (line 305-306):
```html
  </section>
</main>
```

New:
```html
    </section>
  </div><!-- /content-assets -->

  <!-- ====== EXPENSES CONTENT ====== -->
  <div id="content-expenses" style="display:none;">

    <!-- Expense List Tab -->
    <section id="tab-expenses">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="font-display text-lg font-bold">消费记录</h2>
          <p class="text-sm mt-1" style="color: var(--muted);">
            总计 <span id="expense-total" class="font-mono font-medium" style="color: var(--accent);">¥0</span>
          </p>
        </div>
        <button onclick="openExpenseModal()" class="btn-gold">+ 记录消费</button>
      </div>

      <div id="expenses-empty" class="card text-center py-16" style="display:none;">
        <div class="text-4xl mb-3 opacity-30">📝</div>
        <p style="color: var(--muted);">还没有消费记录</p>
        <p class="text-sm mt-1" style="color: var(--muted);">点击「记录消费」或导入示例数据开始</p>
        <button onclick="loadExpenseDemoData()" class="btn-ghost mt-5" style="padding:8px 20px;">📦 导入示例消费数据</button>
      </div>

      <div id="expenses-list" class="card">
        <div class="asset-row text-xs font-medium" style="color: var(--muted); border-bottom: 1px solid var(--border); grid-template-columns: 1fr 1fr 2fr 1.5fr 80px;">
          <div onclick="toggleExpenseSort('date')" style="cursor:pointer;">日期<span class="sort-indicator" id="expense-sort-date"></span></div>
          <div onclick="toggleExpenseSort('amount')" style="cursor:pointer;">金额<span class="sort-indicator" id="expense-sort-amount"></span></div>
          <div>备注</div><div>标签</div><div></div>
        </div>
        <div id="expenses-rows"></div>
      </div>
    </section>

    <!-- Expense Categories Tab -->
    <section id="tab-expense-categories" style="display:none;">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="font-display text-lg font-bold">消费标签分类</h2>
          <p class="text-sm mt-1" style="color: var(--muted);">管理消费的分类维度与标签</p>
        </div>
        <button onclick="openExpenseCategoryModal()" class="btn-gold">+ 新增分类</button>
      </div>
      <div id="expense-categories-list" class="space-y-4"></div>
    </section>

    <!-- Expense Chart Tab -->
    <section id="tab-expense-chart" style="display:none;">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="font-display text-lg font-bold">消费分布</h2>
          <p class="text-sm mt-1" style="color: var(--muted);">选择一个分类维度和月份，查看消费分布</p>
        </div>
        <div class="flex items-center gap-3">
          <select id="expense-chart-month-select" onchange="renderExpenseChart()" class="text-sm" style="min-width:140px;"></select>
          <select id="expense-chart-category-select" onchange="renderExpenseChart()" class="text-sm" style="min-width:160px;"></select>
        </div>
      </div>
      <div class="card">
        <div id="expense-sunburst-chart" style="width:100%; height:520px;"></div>
        <div id="expense-chart-empty" class="text-center py-16" style="display:none;">
          <p style="color: var(--muted);">暂无消费数据，请先记录消费</p>
        </div>
      </div>
    </section>

    <!-- Expense Trend Tab -->
    <section id="tab-expense-trend" style="display:none;">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="font-display text-lg font-bold">消费趋势</h2>
          <p class="text-sm mt-1" style="color: var(--muted);">按月份查看消费变化趋势</p>
        </div>
        <div class="flex items-center gap-3">
          <select id="expense-trend-category-select" onchange="renderExpenseTrendChart()" class="text-sm" style="min-width:160px;"></select>
          <div class="flex rounded-lg p-0.5 gap-0.5" style="background:var(--border);">
            <button id="expense-trend-mode-value" onclick="setExpenseTrendMode('value')" class="btn-gold px-3 py-1 text-xs rounded-md" style="padding:4px 12px;">金额</button>
            <button id="expense-trend-mode-percent" onclick="setExpenseTrendMode('percent')" class="btn-ghost px-3 py-1 text-xs rounded-md" style="padding:4px 12px;">占比</button>
          </div>
        </div>
      </div>
      <div class="card mb-6">
        <div id="expense-trend-chart" style="width:100%; height:420px;"></div>
        <div id="expense-trend-empty" class="text-center py-16" style="display:none;">
          <p style="color: var(--muted);">暂无消费数据</p>
        </div>
      </div>
    </section>

  </div><!-- /content-expenses -->

</main>
```

- [ ] **Step 2: 保存并刷新浏览器，确认资产内容正常、消费内容隐藏。**

### Task 3: HTML — 消费 Modal（消费记录表单 + 分类表单）

**Files:**
- Modify: `index.html:415-417` (before `<script>`, after last modal `</div>`)

**Interfaces:**
- Produces: Modal #expense-modal, #expense-category-modal; 由 `openExpenseModal()`, `openExpenseCategoryModal()` 打开

- [ ] **Step 1: 在 `</div>` (Import/Export modal 的闭合) 与 `<script>` 之间插入两个新 modal**

```html
<!-- Expense Modal -->
<div id="expense-modal" class="modal-overlay" style="display:none;">
  <div class="modal-content">
    <h3 class="font-display text-lg font-bold mb-6" id="expense-modal-title">记录消费</h3>
    <form id="expense-form" onsubmit="saveExpense(event)">
      <input type="hidden" id="expense-edit-id">
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">日期</label>
          <input type="date" id="expense-date" required class="w-full">
        </div>
        <div>
          <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">金额 (CNY)</label>
          <input type="number" id="expense-amount" required min="0.01" step="0.01" class="w-full" placeholder="0.00">
        </div>
        <div>
          <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">备注</label>
          <input type="text" id="expense-note" class="w-full" placeholder="可选备注">
        </div>
        <div id="expense-tags-section" class="space-y-3"></div>
      </div>
      <div class="flex justify-end gap-3 mt-8">
        <button type="button" onclick="closeModal('expense-modal')" class="btn-ghost">取消</button>
        <button type="submit" class="btn-gold">保存</button>
      </div>
    </form>
  </div>
</div>

<!-- Expense Category Modal -->
<div id="expense-category-modal" class="modal-overlay" style="display:none;">
  <div class="modal-content">
    <h3 class="font-display text-lg font-bold mb-6" id="expense-category-modal-title">新增消费分类</h3>
    <form id="expense-category-form" onsubmit="saveExpenseCategory(event)">
      <input type="hidden" id="expense-cat-edit-id">
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">分类名称</label>
          <input type="text" id="expense-cat-name" required class="w-full" placeholder="如：支付方式">
        </div>
        <div>
          <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">标签（逗号分隔）</label>
          <input type="text" id="expense-cat-tags" required class="w-full" placeholder="如：微信, 支付宝, 现金">
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-8">
        <button type="button" onclick="closeModal('expense-category-modal')" class="btn-ghost">取消</button>
        <button type="submit" class="btn-gold">保存</button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 2: 保存，确认 modals 在 DOM 中但不显示。**

### Task 4: JS — 状态管理扩展 + loadState 消费初始化

**Files:**
- Modify: `index.html:419-490` (STATE section + loadState)

**Interfaces:**
- Produces: `state.expenseCategories` (ExpenseCategory[]), `state.expenses` (Expense[]), `expenseSortBy`, `expenseSortDir`, `expenseTrendMode`, `currentMode`

- [ ] **Step 1: 在 STATE 段添加消费状态变量**

在 `let historyChartMode = 'value';` 之后，`let sortBy = '';` 之前插入：

```js
let expenseSortBy = '';
let expenseSortDir = 'asc';
let expenseTrendMode = 'value';
let currentMode = 'assets';
```

- [ ] **Step 2: 修改 loadState() 添加消费数据初始化**

在 `loadState()` 函数末尾，`state.categories = [...]` 的 fallback 赋值之后（line 484 `}` 之前），添加消费数据初始化：

找到：
```js
    } else {
      state.categories = [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] }];
    }
  } catch(e) {
    state.categories = [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] }];
  }
```

改为：
```js
    } else {
      state.categories = [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] }];
    }
    // init expense data
    if (!state.expenseCategories) {
      state.expenseCategories = [{ id: 'expense-type', name: '消费类别', builtin: true, tags: ['餐饮', '交通', '购物', '住房', '娱乐', '医疗', '教育', '其他'] }];
    }
    if (!state.expenses) state.expenses = [];
  } catch(e) {
    state.categories = [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] }];
    state.expenseCategories = [{ id: 'expense-type', name: '消费类别', builtin: true, tags: ['餐饮', '交通', '购物', '住房', '娱乐', '医疗', '教育', '其他'] }];
    state.expenses = [];
  }
```

- [ ] **Step 3: 修改 saveState() 无需改动（已保存整个 state）**

- [ ] **Step 4: 保存，刷新浏览器，打开 DevTools 查看 localStorage `wealth-manager-data` 确认包含 `expenseCategories` 和 `expenses`**

### Task 5: JS — switchMode + switchTab 模式感知

**Files:**
- Modify: `index.html:531-550` (TABS 段)

**Interfaces:**
- Consumes: `currentMode` 变量, `#tabs-assets`, `#tabs-expenses`, `#content-assets`, `#content-expenses`
- Produces: `switchMode(mode)` 函数, 增强的 `switchTab(tab)` 函数

- [ ] **Step 1: 在 switchTab 之前添加 switchMode 函数**

在 `// ========== TABS ==========` 注释后，`function switchTab` 之前插入：

```js
function switchMode(mode) {
  currentMode = mode;
  document.getElementById('mode-assets').className = mode === 'assets'
    ? 'btn-gold px-4 py-1.5 text-sm rounded-md'
    : 'btn-ghost px-4 py-1.5 text-sm rounded-md';
  document.getElementById('mode-expenses').className = mode === 'expenses'
    ? 'btn-gold px-4 py-1.5 text-sm rounded-md'
    : 'btn-ghost px-4 py-1.5 text-sm rounded-md';

  document.getElementById('tabs-assets').style.display = mode === 'assets' ? '' : 'none';
  document.getElementById('tabs-expenses').style.display = mode === 'expenses' ? '' : 'none';
  document.getElementById('content-assets').style.display = mode === 'assets' ? '' : 'none';
  document.getElementById('content-expenses').style.display = mode === 'expenses' ? '' : 'none';

  if (mode === 'assets') {
    switchTab('assets');
  } else {
    switchTab('expenses');
  }
}
```

- [ ] **Step 2: 扩展 switchTab 支持消费 tab**

在现有 `switchTab(tab)` 函数中添加消费 tab 的显示/隐藏逻辑。定位到 `if (tab === 'income')` 之后，在 `}` 闭合之前：

找到：
```js
  if (tab === 'income') {
    setTimeout(() => renderIncomeTab(), 100);
  }
}
```

改为：
```js
  if (tab === 'income') {
    setTimeout(() => renderIncomeTab(), 100);
  }
  // expense tabs
  document.getElementById('tab-expenses').style.display = tab === 'expenses' ? '' : 'none';
  document.getElementById('tab-expense-categories').style.display = tab === 'expense-categories' ? '' : 'none';
  document.getElementById('tab-expense-chart').style.display = tab === 'expense-chart' ? '' : 'none';
  document.getElementById('tab-expense-trend').style.display = tab === 'expense-trend' ? '' : 'none';
  // highlight active tab button in expense tab bar
  document.querySelectorAll('#tabs-expenses .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'expense-categories') {
    renderExpenseCategories();
  }
  if (tab === 'expense-chart') {
    populateExpenseChartSelects();
    setTimeout(() => renderExpenseChart(), 100);
  }
  if (tab === 'expense-trend') {
    populateExpenseTrendSelect();
    setTimeout(() => renderExpenseTrendChart(), 100);
  }
}
```

Note: the asset tab highlight for `switchTab` already uses `.tab-btn` selector but that's in `#tabs-assets` — this works because only one tab bar is visible at a time. The new code adds explicit expense tab highlighting for safety.

- [ ] **Step 3: 修改 renderAll() 添加消费渲染**

找到：
```js
function renderAll() {
  renderAssets();
  renderCategories();
  renderHistoryTab();
}
```

改为：
```js
function renderAll() {
  renderAssets();
  renderCategories();
  renderHistoryTab();
  renderExpenses();
  renderExpenseCategories();
}
```

- [ ] **Step 4: 保存，刷新浏览器，点击模式切换器确认切换正常、Tab 切换正常。**

### Task 6: JS — 消费记录 CRUD

**Files:**
- Modify: `index.html` — 在 `</script>` 之前插入（约 line 1639）

**Interfaces:**
- Consumes: `state.expenses`, `state.expenseCategories`, `expenseSortBy`, `expenseSortDir`
- Produces: `renderExpenses()`, `openExpenseModal(editId?)`, `saveExpense(e)`, `editExpense(id)`, `deleteExpense(id)`, `toggleExpenseSort(field)`

- [ ] **Step 1: 在 script 末尾 `</script>` 前插入消费 CRUD 函数**

```js
// ========== EXPENSE CRUD ==========
function renderExpenses() {
  const rows = document.getElementById('expenses-rows');
  const empty = document.getElementById('expenses-empty');
  const list = document.getElementById('expenses-list');

  if (state.expenses.length === 0) {
    empty.style.display = '';
    list.style.display = 'none';
  } else {
    empty.style.display = 'none';
    list.style.display = '';
    let sorted = [...state.expenses];
    if (expenseSortBy) {
      sorted.sort((a, b) => {
        let va = a[expenseSortBy], vb = b[expenseSortBy];
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return expenseSortDir === 'asc' ? -1 : 1;
        if (va > vb) return expenseSortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    ['date', 'amount'].forEach(f => {
      const el = document.getElementById('expense-sort-' + f);
      if (el) {
        el.textContent = expenseSortBy === f ? (expenseSortDir === 'asc' ? ' ▲' : ' ▼') : '';
        el.className = 'sort-indicator' + (expenseSortBy === f ? ' active' : '');
      }
    });
    rows.innerHTML = sorted.map(e => {
      const tagHtml = state.expenseCategories.map(cat => {
        const tagVal = e.tags[cat.id];
        if (!tagVal) return '';
        const c = expenseCatColor(cat.id, tagVal);
        return `<span class="tag-pill" style="background:${c.bg};color:${c.fg};border:1px solid ${c.border};">${cat.name}: ${tagVal}</span>`;
      }).join(' ');
      return `<div class="asset-row" style="grid-template-columns: 1fr 1fr 2fr 1.5fr 80px;">
        <div class="font-mono text-sm">${e.date}</div>
        <div class="font-mono text-sm">${e.amount.toLocaleString('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
        <div class="text-sm" style="color:var(--muted);">${esc(e.note) || '—'}</div>
        <div class="flex flex-wrap gap-1">${tagHtml}</div>
        <div class="flex gap-2 justify-end">
          <button onclick="editExpense('${e.id}')" class="text-xs" style="color:var(--accent);cursor:pointer;">编辑</button>
          <button onclick="deleteExpense('${e.id}')" class="btn-danger" style="padding:3px 8px;font-size:11px;">删除</button>
        </div>
      </div>`;
    }).join('');
  }

  const total = state.expenses.reduce((s, e) => s + e.amount, 0);
  document.getElementById('expense-total').textContent = formatCNY(total);
}

function openExpenseModal(editId) {
  const modal = document.getElementById('expense-modal');
  const title = document.getElementById('expense-modal-title');
  const form = document.getElementById('expense-form');
  form.reset();
  document.getElementById('expense-edit-id').value = editId || '';
  document.getElementById('expense-date').value = new Date().toISOString().slice(0, 10);

  if (editId) {
    title.textContent = '编辑消费';
    const e = state.expenses.find(x => x.id === editId);
    if (e) {
      document.getElementById('expense-date').value = e.date;
      document.getElementById('expense-amount').value = e.amount;
      document.getElementById('expense-note').value = e.note || '';
    }
  } else {
    title.textContent = '记录消费';
  }

  const section = document.getElementById('expense-tags-section');
  section.innerHTML = state.expenseCategories.map(cat => {
    const expense = editId ? state.expenses.find(x => x.id === editId) : null;
    const selected = expense ? (expense.tags[cat.id] || '') : '';
    const options = cat.tags.map(t =>
      `<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(t)}</option>`
    ).join('');
    return `<div>
      <label class="block text-xs font-medium mb-1.5" style="color:var(--muted);">${esc(cat.name)}</label>
      <select id="expense-tag-${cat.id}" class="w-full" required>
        <option value="">请选择</option>
        ${options}
      </select>
    </div>`;
  }).join('');

  modal.style.display = '';
}

function saveExpense(e) {
  e.preventDefault();
  const editId = document.getElementById('expense-edit-id').value;
  const date = document.getElementById('expense-date').value;
  const amount = parseFloat(document.getElementById('expense-amount').value);
  const note = document.getElementById('expense-note').value.trim();

  if (!date) { toast('请选择日期', 'error'); return; }
  if (!amount || amount <= 0) { toast('金额必须大于 0', 'error'); return; }

  const tags = {};
  let tagsValid = true;
  state.expenseCategories.forEach(cat => {
    const el = document.getElementById(`expense-tag-${cat.id}`);
    const val = el ? el.value : '';
    if (val) tags[cat.id] = val;
    else tagsValid = false;
  });

  if (!tagsValid) {
    toast('请为每个分类选择标签', 'error');
    return;
  }

  if (editId) {
    const idx = state.expenses.findIndex(x => x.id === editId);
    if (idx >= 0) state.expenses[idx] = { ...state.expenses[idx], date, amount, note, tags };
  } else {
    state.expenses.push({ id: genId(), date, amount, note, tags });
  }

  saveState();
  renderExpenses();
  closeModal('expense-modal');
  toast(editId ? '消费已更新' : '消费已记录', 'success');
}

function editExpense(id) {
  openExpenseModal(id);
}

function deleteExpense(id) {
  if (!confirm('确认删除该消费记录？')) return;
  state.expenses = state.expenses.filter(e => e.id !== id);
  saveState();
  renderExpenses();
  toast('已删除', 'success');
}

function toggleExpenseSort(field) {
  if (expenseSortBy === field) {
    expenseSortDir = expenseSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    expenseSortBy = field;
    expenseSortDir = 'asc';
  }
  renderExpenses();
}
```

- [ ] **Step 2: 保存，切换到消费模式，确认「记录消费」弹窗可以打开和关闭（保存会报错因分类渲染函数未完成，但弹窗 UI 正常即可）**

### Task 7: JS — 消费分类 CRUD

**Files:**
- Modify: `index.html` — 在 Task 6 代码之后插入

**Interfaces:**
- Consumes: `state.expenseCategories`, `state.expenses`
- Produces: `renderExpenseCategories()`, `openExpenseCategoryModal(editId?)`, `saveExpenseCategory(e)`, `deleteExpenseCategory(id)`, `addExpenseTag(catId)`, `removeExpenseTag(catId, tagName)`, `expenseCatColor(catId, tagName)`

- [ ] **Step 1: 在 Task 6 代码后插入消费分类 CRUD + 颜色函数**

```js
// ========== EXPENSE CATEGORY CRUD ==========
function expenseCatColor(catId, tagName) {
  const idx = state.expenseCategories.findIndex(c => c.id === catId);
  const base = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
  if (!tagName) return { ...base };

  const cat = state.expenseCategories.find(c => c.id === catId);
  if (!cat || cat.tags.length <= 1) return { ...base };

  const ti = cat.tags.indexOf(tagName);
  if (ti < 0) return { ...base };

  const t = ti / (cat.tags.length - 1);
  const hsl = hexToHsl(base.bg);
  const h = hsl.h;

  return {
    bg: hslToHex(h, 35 + t * 20, 90 - t * 20),
    fg: hslToHex(h, 50, 38),
    border: hslToHex(h, 30 + t * 18, 78 - t * 26),
  };
}

function renderExpenseCategories() {
  const container = document.getElementById('expense-categories-list');
  container.innerHTML = state.expenseCategories.map(cat => {
    const tagPills = cat.tags.map(t => {
      const c = expenseCatColor(cat.id, t);
      return `<span class="tag-pill" style="background:${c.bg};color:${c.fg};border:1px solid ${c.border};">${esc(t)}${!cat.builtin ? ` <button onclick="removeExpenseTag('${cat.id}','${esc(t)}')" style="margin-left:2px;cursor:pointer;font-size:10px;line-height:1;color:${c.fg};">✕</button>` : ''}</span>`;
    }).join(' ');
    return `<div class="card">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <h3 class="font-display font-bold">${esc(cat.name)}</h3>
          ${cat.builtin ? '<span class="text-xs px-2 py-0.5 rounded" style="background:#f0ece0;color:var(--muted);">内置</span>' : ''}
        </div>
        <div class="flex gap-2">
          ${!cat.builtin ? `<button onclick="editExpenseCategory('${cat.id}')" class="text-xs" style="color:var(--accent);cursor:pointer;">编辑</button>
          <button onclick="deleteExpenseCategory('${cat.id}')" class="btn-danger" style="padding:3px 8px;font-size:11px;">删除</button>` : ''}
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mb-3">${tagPills}</div>
      <div class="flex gap-2">
        <input type="text" id="expense-new-tag-${cat.id}" placeholder="新增标签" class="text-sm flex-1" style="padding:6px 10px;">
        <button onclick="addExpenseTag('${cat.id}')" class="btn-ghost" style="padding:6px 14px;">添加</button>
      </div>
    </div>`;
  }).join('');
}

function openExpenseCategoryModal(editId) {
  const modal = document.getElementById('expense-category-modal');
  const title = document.getElementById('expense-category-modal-title');
  const form = document.getElementById('expense-category-form');
  form.reset();
  document.getElementById('expense-cat-edit-id').value = editId || '';

  if (editId) {
    title.textContent = '编辑消费分类';
    const c = state.expenseCategories.find(x => x.id === editId);
    if (c) {
      document.getElementById('expense-cat-name').value = c.name;
      document.getElementById('expense-cat-tags').value = c.tags.join(', ');
    }
  } else {
    title.textContent = '新增消费分类';
  }
  modal.style.display = '';
}

function saveExpenseCategory(e) {
  e.preventDefault();
  const editId = document.getElementById('expense-cat-edit-id').value;
  const name = document.getElementById('expense-cat-name').value.trim();
  const tagsStr = document.getElementById('expense-cat-tags').value.trim();
  const tags = tagsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);

  if (tags.length === 0) {
    toast('至少需要一个标签', 'error');
    return;
  }

  if (editId) {
    const idx = state.expenseCategories.findIndex(c => c.id === editId);
    if (idx >= 0) {
      const oldTags = state.expenseCategories[idx].tags;
      state.expenseCategories[idx] = { ...state.expenseCategories[idx], name, tags };
      state.expenses.forEach(e => {
        if (e.tags[editId] && !tags.includes(e.tags[editId])) {
          delete e.tags[editId];
        }
      });
    }
  } else {
    state.expenseCategories.push({ id: genId(), name, builtin: false, tags });
  }

  saveState();
  renderExpenseCategories();
  renderExpenses();
  closeModal('expense-category-modal');
  toast(editId ? '消费分类已更新' : '消费分类已创建', 'success');
}

function editExpenseCategory(id) {
  openExpenseCategoryModal(id);
}

function deleteExpenseCategory(id) {
  const cat = state.expenseCategories.find(c => c.id === id);
  if (cat && cat.builtin) return;
  if (!confirm(`确认删除分类「${cat.name}」？该分类下消费记录的标签关联也会被移除。`)) return;
  state.expenseCategories = state.expenseCategories.filter(c => c.id !== id);
  state.expenses.forEach(e => { delete e.tags[id]; });
  saveState();
  renderExpenseCategories();
  renderExpenses();
  toast('消费分类已删除', 'success');
}

function addExpenseTag(catId) {
  const input = document.getElementById(`expense-new-tag-${catId}`);
  const val = input.value.trim();
  if (!val) return;
  const cat = state.expenseCategories.find(c => c.id === catId);
  if (cat.tags.includes(val)) { toast('标签已存在', 'error'); return; }
  cat.tags.push(val);
  saveState();
  renderExpenseCategories();
  renderExpenses();
  input.value = '';
  toast('标签已添加', 'success');
}

function removeExpenseTag(catId, tagName) {
  const cat = state.expenseCategories.find(c => c.id === catId);
  if (!cat) return;
  if (cat.tags.length <= 1) { toast('至少保留一个标签', 'error'); return; }
  cat.tags = cat.tags.filter(t => t !== tagName);
  state.expenses.forEach(e => {
    if (e.tags[catId] === tagName) delete e.tags[catId];
  });
  saveState();
  renderExpenseCategories();
  renderExpenses();
  toast('标签已移除', 'success');
}
```

- [ ] **Step 2: 保存，切换到消费模式 → 标签分类 Tab，确认内置分类显示、添加新分类正常工作。**

### Task 8: JS — 消费旭日图 + 月份选择器

**Files:**
- Modify: `index.html` — 在 Task 7 代码之后插入

**Interfaces:**
- Consumes: `state.expenses`, `state.expenseCategories`, `#expense-chart-month-select`, `#expense-chart-category-select`
- Produces: `expenseChart` (echarts 实例), `populateExpenseChartSelects()`, `renderExpenseChart()`

- [ ] **Step 1: 插入消费旭日图代码**

```js
// ========== EXPENSE CHART ==========
let expenseChart = null;

function populateExpenseChartSelects() {
  const catSel = document.getElementById('expense-chart-category-select');
  const currentCat = catSel.value;
  catSel.innerHTML = state.expenseCategories.map(c =>
    `<option value="${c.id}">${esc(c.name)}</option>`
  ).join('');
  if (currentCat && catSel.querySelector(`option[value="${currentCat}"]`)) catSel.value = currentCat;

  const monthSel = document.getElementById('expense-chart-month-select');
  const currentMonth = monthSel.value;
  const months = [...new Set(state.expenses.map(e => e.date.slice(0, 7)))].sort().reverse();
  monthSel.innerHTML = '<option value="">全部时间</option>' +
    months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  if (currentMonth && monthSel.querySelector(`option[value="${currentMonth}"]`)) monthSel.value = currentMonth;
  else monthSel.value = '';
}

function renderExpenseChart() {
  const catId = document.getElementById('expense-chart-category-select').value;
  const monthFilter = document.getElementById('expense-chart-month-select').value;
  if (!catId) return;

  const chartEl = document.getElementById('expense-sunburst-chart');
  const emptyEl = document.getElementById('expense-chart-empty');

  const filtered = monthFilter
    ? state.expenses.filter(e => e.date.slice(0, 7) === monthFilter)
    : state.expenses;

  if (filtered.length === 0) {
    chartEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }
  chartEl.style.display = '';
  emptyEl.style.display = 'none';

  const cat = state.expenseCategories.find(c => c.id === catId);
  if (!cat) return;

  // group by tag → expense names, merging amounts
  const groups = {};
  cat.tags.forEach(t => { groups[t] = {}; });
  filtered.forEach(e => {
    const tagVal = e.tags[catId];
    if (tagVal && groups[tagVal]) {
      const key = e.note || e.date; // use note or date as display name
      if (!groups[tagVal][key]) groups[tagVal][key] = 0;
      groups[tagVal][key] += e.amount;
    }
  });

  const total = filtered.reduce((s, e) => s + e.amount, 0);

  const data = cat.tags.filter(t => Object.keys(groups[t]).length > 0).map((tag, ti) => {
    const pal = CATEGORY_PALETTE[ti % CATEGORY_PALETTE.length];
    const children = Object.entries(groups[tag]).map(([name, val], ai) => ({
      name: name,
      value: Math.round(val * 100) / 100,
      itemStyle: { color: pal.shades[ai % pal.shades.length] }
    }));
    return { name: tag, itemStyle: { color: pal.base }, children };
  });

  if (!expenseChart) {
    expenseChart = echarts.init(chartEl);
  }

  expenseChart.setOption({
    backgroundColor: 'transparent',
    series: [{
      type: 'sunburst',
      data: data,
      radius: ['12%', '90%'],
      sort: null,
      emphasis: { focus: 'ancestor' },
      levels: [
        {},
        {
          r0: '12%', r: '50%',
          itemStyle: { borderWidth: 2, borderColor: '#faf8f2' },
          label: { rotate: 'tangential', fontSize: 13, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', color: '#fff',
            formatter: function(p) { return p.name; }
          }
        },
        {
          r0: '50%', r: '90%',
          itemStyle: { borderWidth: 1, borderColor: '#faf8f2' },
          label: { rotate: 'radial', fontSize: 11, fontFamily: '"IBM Plex Mono", monospace', color: '#1a1712',
            formatter: function(p) { return p.name; }
          }
        }
      ]
    }],
    tooltip: {
      trigger: 'item',
      formatter: function(p) {
        const pct = total > 0 ? ((p.value / total) * 100).toFixed(1) : '0.0';
        const emoji = p.treePathInfo && p.treePathInfo.length <= 2 ? '🏷️' : '💰';
        const arrow = p.treePathInfo && p.treePathInfo.length > 2
          ? '🏷️ ' + p.treePathInfo[1].name + ' › '
          : '';
        return `${emoji} <b>${arrow}${p.name}</b><br/>💵 ${formatCNY(p.value)}&nbsp;&nbsp;📊 ${pct}%`;
      }
    }
  }, true);
}
```

- [ ] **Step 2: 保存，切换到消费模式 → 消费分布 Tab，确认月份和分类选择器初始化正常。**

### Task 9: JS — 消费趋势柱状图

**Files:**
- Modify: `index.html` — 在 Task 8 代码之后插入

**Interfaces:**
- Consumes: `state.expenses`, `state.expenseCategories`, `expenseTrendMode`
- Produces: `expenseTrendChart` (echarts 实例), `populateExpenseTrendSelect()`, `renderExpenseTrendChart()`, `setExpenseTrendMode(mode)`

- [ ] **Step 1: 插入消费趋势图代码**

```js
// ========== EXPENSE TREND ==========
let expenseTrendChart = null;

function populateExpenseTrendSelect() {
  const sel = document.getElementById('expense-trend-category-select');
  const current = sel.value;
  sel.innerHTML = state.expenseCategories.map(c =>
    `<option value="${c.id}">${esc(c.name)}</option>`
  ).join('');
  if (current && sel.querySelector(`option[value="${current}"]`)) sel.value = current;
}

function setExpenseTrendMode(mode) {
  expenseTrendMode = mode;
  document.getElementById('expense-trend-mode-value').className = mode === 'value'
    ? 'btn-gold px-3 py-1 text-xs rounded-md' : 'btn-ghost px-3 py-1 text-xs rounded-md';
  document.getElementById('expense-trend-mode-percent').className = mode === 'percent'
    ? 'btn-gold px-3 py-1 text-xs rounded-md' : 'btn-ghost px-3 py-1 text-xs rounded-md';
  renderExpenseTrendChart();
}

function renderExpenseTrendChart() {
  const catId = document.getElementById('expense-trend-category-select').value;
  const chartEl = document.getElementById('expense-trend-chart');
  const emptyEl = document.getElementById('expense-trend-empty');

  if (state.expenses.length === 0) {
    chartEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }
  chartEl.style.display = '';
  emptyEl.style.display = 'none';

  const cat = state.expenseCategories.find(c => c.id === catId);
  if (!cat) return;

  // aggregate by month
  const monthMap = {};
  state.expenses.forEach(e => {
    const m = e.date.slice(0, 7);
    if (!monthMap[m]) monthMap[m] = {};
    cat.tags.forEach(tag => {
      if (!monthMap[m][tag]) monthMap[m][tag] = 0;
    });
    const tagVal = e.tags[catId];
    if (tagVal && monthMap[m][tagVal] != null) {
      monthMap[m][tagVal] += e.amount;
    }
  });

  const sorted = Object.keys(monthMap).sort();
  const dates = sorted.map(m => monthLabel(m));

  const totals = sorted.map(m => {
    return cat.tags.reduce((s, tag) => s + (monthMap[m][tag] || 0), 0);
  });

  const series = cat.tags.map((tag, si) => {
    const isLast = si === cat.tags.length - 1;
    const raw = sorted.map(m => monthMap[m][tag] || 0);
    const data = expenseTrendMode === 'percent'
      ? raw.map((v, vi) => ({ value: totals[vi] > 0 ? +(v / totals[vi] * 100).toFixed(1) : 0, raw: Math.round(v * 100) / 100 }))
      : raw;
    const pal = CATEGORY_PALETTE[si % CATEGORY_PALETTE.length];
    return {
      name: tag, type: 'bar', stack: 'total', data,
      itemStyle: { color: pal.base },
      emphasis: { focus: 'self' },
      blur: { itemStyle: { opacity: 0.2 } },
      label: isLast && expenseTrendMode === 'value' ? {
        show: true,
        position: 'top',
        formatter: function(p) { return formatCNY(totals[p.dataIndex]); },
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 11,
        color: '#5e5337',
      } : undefined,
    };
  });

  if (!expenseTrendChart) {
    expenseTrendChart = echarts.init(chartEl);
  }

  expenseTrendChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: function(p) {
        const idx = p.dataIndex;
        const d = dates[idx];
        const total = totals[idx];
        if (expenseTrendMode === 'percent') {
          const raw = p.data && p.data.raw != null ? p.data.raw : 0;
          return `<b>${d}</b><br/>${p.marker} ${p.seriesName}: ${p.value}% (${formatCNY(raw)})`;
        }
        const pct = total > 0 ? ((p.value / total) * 100).toFixed(1) : '0.0';
        return `<b>${d}</b><br/>${p.marker} ${p.seriesName}: ${formatCNY(p.value)} (${pct}%)`;
      }
    },
    legend: { show: true, type: 'scroll', bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '22%', top: '10%', containLabel: true },
    xAxis: { type: 'category', data: dates, axisLabel: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 11 } },
    yAxis: expenseTrendMode === 'percent'
      ? { type: 'value', max: 100, axisLabel: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, formatter: '{value}%' } }
      : { type: 'value', axisLabel: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, formatter: v => v.toLocaleString('zh-CN', {minimumFractionDigits:0, maximumFractionDigits:0}) } },
    series
  }, true);
}
```

- [ ] **Step 2: 保存。**

### Task 10: JS — 消费示例数据 + resize 更新

**Files:**
- Modify: `index.html` — 在 Task 9 代码之后插入

**Interfaces:**
- Consumes: `state.expenseCategories`, `state.expenses`
- Produces: `loadExpenseDemoData()` 函数

- [ ] **Step 1: 插入消费示例数据函数**

```js
// ========== EXPENSE DEMO DATA ==========
function loadExpenseDemoData() {
  if (state.expenses.length > 0) {
    if (!confirm('导入示例数据将覆盖当前所有消费数据，确认继续？')) return;
  }
  // ensure built-in category
  if (!state.expenseCategories.find(c => c.id === 'expense-type')) {
    state.expenseCategories.unshift({ id: 'expense-type', name: '消费类别', builtin: true, tags: ['餐饮', '交通', '购物', '住房', '娱乐', '医疗', '教育', '其他'] });
  }
  const catPay = { id: genId(), name: '支付方式', builtin: false, tags: ['微信', '支付宝', '现金', '银行卡'] };
  const catFreq = { id: genId(), name: '消费频率', builtin: false, tags: ['日常', '偶尔', '一次性'] };
  const expenseTypeCat = state.expenseCategories.find(c => c.id === 'expense-type');
  state.expenseCategories = [expenseTypeCat, catPay, catFreq];

  const now = new Date();
  const monthOffsets = [5, 4, 3, 2, 1, 0]; // 6 months
  const seed = [
    { note: '午餐外卖', amt: 35, type: '餐饮', pay: '微信', freq: '日常' },
    { note: '地铁通勤', amt: 12, type: '交通', pay: '支付宝', freq: '日常' },
    { note: '超市采购', amt: 156, type: '购物', pay: '微信', freq: '偶尔' },
    { note: '房租', amt: 3500, type: '住房', pay: '银行卡', freq: '一次性' },
    { note: '电影票', amt: 78, type: '娱乐', pay: '支付宝', freq: '偶尔' },
    { note: '药房买药', amt: 45, type: '医疗', pay: '现金', freq: '偶尔' },
    { note: '网课订阅', amt: 299, type: '教育', pay: '微信', freq: '一次性' },
    { note: '咖啡', amt: 28, type: '餐饮', pay: '微信', freq: '日常' },
    { note: '打车', amt: 42, type: '交通', pay: '支付宝', freq: '日常' },
    { note: '衣服', amt: 238, type: '购物', pay: '银行卡', freq: '偶尔' },
    { note: '水电费', amt: 186, type: '住房', pay: '微信', freq: '一次性' },
    { note: '游戏充值', amt: 68, type: '娱乐', pay: '支付宝', freq: '偶尔' },
    { note: '理发', amt: 58, type: '其他', pay: '现金', freq: '偶尔' },
  ];

  const jitter = [0, 0.05, -0.1, 0.03, 0.08, -0.02]; // monthly variation

  state.expenses = [];
  monthOffsets.forEach((off, mi) => {
    const year = now.getFullYear();
    const month = now.getMonth() - off;
    const d = new Date(year, month, 1);
    const monthStr = d.toISOString().slice(0, 7);
    const factor = 1 + jitter[mi];
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

    seed.forEach((s, si) => {
      const day = Math.min(1 + (si * 3 + mi * 5) % 28, daysInMonth); // spread across month
      const dayStr = String(day).padStart(2, '0');
      // only include housing once per month, make others vary
      if (s.type === '住房' || s.type === '一次性' || si % 3 === mi % 3) {
        state.expenses.push({
          id: genId(),
          date: `${monthStr}-${dayStr}`,
          amount: Math.round(s.amt * factor * 100) / 100,
          note: s.note,
          tags: { [expenseTypeCat.id]: s.type, [catPay.id]: s.pay, [catFreq.id]: s.freq },
        });
      }
    });
  });

  saveState();
  renderExpenses();
  renderExpenseCategories();
  toast('示例消费数据已导入（' + monthOffsets.length + '个月）', 'success');
}
```

- [ ] **Step 2: 更新 resize listener 以包含消费图表**

找到现有的 resize 监听器：
```js
    window.addEventListener('resize', () => {
      if (chart) chart.resize();
      if (historyChart) historyChart.resize();
      if (incomeChart) incomeChart.resize();
    });
```

改为：
```js
    window.addEventListener('resize', () => {
      if (chart) chart.resize();
      if (historyChart) historyChart.resize();
      if (incomeChart) incomeChart.resize();
      if (expenseChart) expenseChart.resize();
      if (expenseTrendChart) expenseTrendChart.resize();
    });
```

- [ ] **Step 3: 保存，切换到消费模式 → 消费记录，点击「导入示例消费数据」，确认数据导入成功、列表展示正常。**

### Task 11: JS — 导入/导出兼容 + 最终集成

**Files:**
- Modify: `index.html` — `exportData()` 和 `importData()` 函数

**Interfaces:**
- Consumes: `state` (已含 expense 字段)
- Produces: 无新接口，确保导入导出覆盖消费数据

- [ ] **Step 1: 修改 importData() 添加向后兼容**

`exportData()` 无需改动（已导出整个 state）。`importData()` 需要在回调中添加消费数据初始化：

找到 `importData()` 中的：
```js
      if (data.categories && data.assets) {
        state = { ...state, ...data };
        saveState();
        renderAll();
        closeModal('io-modal');
        toast('数据已导入', 'success');
      }
```

改为：
```js
      if (data.categories && data.assets) {
        state = { ...state, ...data };
        // ensure expense data exists for older exports
        if (!state.expenseCategories || !Array.isArray(state.expenseCategories)) {
          state.expenseCategories = [{ id: 'expense-type', name: '消费类别', builtin: true, tags: ['餐饮', '交通', '购物', '住房', '娱乐', '医疗', '教育', '其他'] }];
        }
        if (!state.expenses || !Array.isArray(state.expenses)) {
          state.expenses = [];
        }
        saveState();
        renderAll();
        closeModal('io-modal');
        toast('数据已导入', 'success');
      }
```

- [ ] **Step 2: 确保 switchTab 中 asset tabs 高亮不污染 expense tabs**

在 `switchTab` 顶部，添加限制 asset tab 高亮只在 asset 模式下生效：

在 `switchTab` 函数的 `document.querySelectorAll('.tab-btn')...` 那一行改为：
```js
  // only highlight tabs in the visible tab bar
  const tabBar = currentMode === 'assets' ? '#tabs-assets' : '#tabs-expenses';
  document.querySelectorAll(`${tabBar} .tab-btn`).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
```

删除原 `switchTab` 中已被替换的：
```js
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
```

以及删除 Task 5 Step 2 中添加的：
```js
  document.querySelectorAll('#tabs-expenses .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
```

- [ ] **Step 3: 保存，完整测试流程：**

1. 刷新页面，确认资产模式所有功能正常
2. 切换到消费模式
3. 导入示例消费数据
4. 查看消费记录列表、排序
5. 编辑某条消费，保存
6. 删除某条消费
7. 切换到标签分类，确认内置+自定义分类显示
8. 添加新分类、添加新标签
9. 切换到消费分布，切换月份、切换分类维度
10. 切换到消费趋势，切换金额/占比模式
11. 导出数据，刷新，重新导入，确认消费数据保留
12. 切换暗色模式，确认消费 UI 正常
13. 切回资产模式，确认资产数据未被影响

### Task 12: 最终验证 + 修复

**Files:**
- Modify: `index.html` — 根据测试结果修复问题

**Interfaces:**
- 无新增接口，修复型任务

- [ ] **Step 1: 确保 modal overlay 点击关闭对消费 modal 也生效**

`closeModal` 和 overlay click handler 已通过 id 参数通用，无需改动。验证消费 modal 可以点击遮罩关闭。

- [ ] **Step 2: 确保 `CATEGORY_COLORS` 和 `CATEGORY_PALETTE` 在消费函数调用之前定义**

在 JS 中，`CATEGORY_COLORS` 在 line ~1527 定义，消费代码在 `</script>` 之前插入，顺序正确。

- [ ] **Step 3: 验证空状态提示**

切换消费模式（无数据时），确认：
- 消费记录显示空状态 + 导入示例按钮
- 消费分布显示「暂无消费数据」
- 消费趋势显示「暂无消费数据」

- [ ] **Step 4: 提交最终代码**

```bash
git add index.html
git commit -m "feat: 消费记账功能完整实现"
```
