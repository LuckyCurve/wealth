# 历史净值月度改造 实施计划

> **For agentic workers:** Single-file SPA, no build tool, no test framework. Verification done by opening `index.html` in browser and checking behavior.

**Goal:** 将历史净值从"用户可随时高频记录快照"改为"以月为单位记录"，同月只保留一条记录

**架构:** 单文件 `index.html` 内全量改动。snapshot 主键从 `id` 改为 `month`（YYYY-MM），`loadState()` 做旧数据迁移。TAB 头部根据当前月份是否已有记录展示不同状态

**Tech Stack:** 纯 HTML/CSS/JS (vanilla), localStorage, ECharts 5

## 全局约束

- 所有改动在 `index.html` 一个文件内
- 不引入新依赖
- 旧数据自动迁移，不弹窗提示用户
- 不改变数据导出/导入格式（JSON 中 snapshots 结构会变但导入能正确处理）

---

### Task 1: 数据迁移 + 工具函数

**Files:**
- Modify: `index.html` (loadState, 新增工具函数)

**Interfaces:**
- Produces: `getCurrentMonth()` → `"2026-06"`, `monthLabel("2026-06")` → `"2026年6月"`, `findMonthSnapshot(month)` → snapshot | undefined

- [ ] **Step 1: 修改 loadState()，添加旧数据迁移**

在 `loadState()` 中，在 `if (!state.snapshots) state.snapshots = [];` 之后添加：

```js
// migrate old snapshot format (with 'id') to new monthly format
if (state.snapshots.length > 0 && state.snapshots[0].id) {
  const grouped = {};
  state.snapshots.forEach(s => {
    const m = s.date.slice(0, 7);
    // keep only the latest snapshot per month
    if (!grouped[m] || new Date(s.date) > new Date(grouped[m].date)) {
      grouped[m] = s;
    }
  });
  state.snapshots = Object.entries(grouped).map(([month, s]) => ({
    month,
    note: s.note || '',
    totalCNY: s.totalCNY,
    currencyRates: s.currencyRates,
    assets: s.assets,
    updatedAt: s.date,
  }));
}
```

- [ ] **Step 2: 添加三个工具函数**

在 `genId()` 函数附近添加：

```js
function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(month) {
  const d = new Date(month + '-01');
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
}

function findMonthSnapshot(month) {
  return state.snapshots.find(s => s.month === month);
}
```

- [ ] **Step 3: 验证**

在浏览器中打开 `index.html`，若 localStorage 中有旧格式数据，打开后应看到 snapshots 已转为新格式（可以 DevTools 中检查 localStorage 的 `wealth-manager-data` key）

- [ ] **Step 4: 清理——移除不再使用的 snapshot id 引用**（如果有的话，目前没有其他地方直接使用 snapshot.id）

---

### Task 2: 记录/覆盖快照逻辑

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `getCurrentMonth()`, `findMonthSnapshot(month)`
- Produces: `confirmSnapshot(overwrite)` — 接受可选 overwrite 参数

- [ ] **Step 1: 修改 `takeSnapshot()`**

不需要大改，但按钮文案后续会在 UI 中动态更新。`takeSnapshot()` 本身只负责打开备注弹窗即可，无需改动。

- [ ] **Step 2: 修改 `confirmSnapshot()`**

```js
function confirmSnapshot(overwrite) {
  const note = document.getElementById('snapshot-note-input').value.trim();
  const month = getCurrentMonth();
  const existing = findMonthSnapshot(month);

  if (existing && !overwrite) {
    closeModal('snapshot-note-modal');
    toast('本月已有记录，无需重复记录', 'error');
    return;
  }

  closeModal('snapshot-note-modal');
  const snap = {
    month,
    note: note || '',
    totalCNY: state.assets.reduce((s, a) => s + toCNY(a.amount, a.currency), 0),
    currencyRates: { ...state.rates },
    assets: JSON.parse(JSON.stringify(state.assets)),
    updatedAt: new Date().toISOString(),
  };

  if (existing && overwrite) {
    const idx = state.snapshots.findIndex(s => s.month === month);
    state.snapshots[idx] = snap;
    toast('本月数据已覆盖更新', 'success');
  } else {
    state.snapshots.push(snap);
    toast('快照已记录', 'success');
  }

  saveState();
  renderAll();
}
```

- [ ] **Step 3: 验证**

在浏览器中：
1. 切换到历史净值 TAB
2. 点击「记录快照」→ 填写备注 → 确认 → 应显示"快照已记录"
3. 再次点击「记录快照」→ 确认 → 应显示"本月已有记录"提示
4. 后续会添加"覆盖更新"入口

---

### Task 3: 历史净值 TAB 头部 UI——状态感知

**Files:**
- Modify: `index.html`（HTML 的 history tab 部分 + JS 渲染逻辑）

- [ ] **Step 1: 修改 HTML 模板**

将 `#tab-history` 中的头部按钮区域从：

```html
<div class="flex items-center gap-3">
  <select id="history-category-select" ...></select>
  <button onclick="takeSnapshot()" class="btn-gold">📸 记录快照</button>
</div>
```

改为：

```html
<div class="flex items-center gap-3">
  <select id="history-category-select" ...></select>
  <div id="history-record-area"></div>
</div>
```

- [ ] **Step 2: 新增 `renderHistoryHeader()` 函数**

```js
function renderHistoryHeader() {
  const area = document.getElementById('history-record-area');
  const month = getCurrentMonth();
  const existing = findMonthSnapshot(month);

  if (existing) {
    area.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-sm" style="color:var(--muted);">
          📅 ${monthLabel(month)} 已记录 ✓
        </span>
        <button onclick="promptOverwrite()" class="btn-ghost text-xs" style="padding:4px 10px;">覆盖更新</button>
      </div>
    `;
  } else {
    area.innerHTML = `<button onclick="takeSnapshot()" class="btn-gold">📸 记录本月数据</button>`;
  }
}
```

- [ ] **Step 3: 新增 `promptOverwrite()` 函数**

覆盖时保留原备注，预填到输入框后再调用 `confirmSnapshot(true)`：

```js
function promptOverwrite() {
  const existing = findMonthSnapshot(getCurrentMonth());
  if (!existing) return;
  if (!confirm('本月已有记录，确定覆盖更新为当前数据？')) return;
  document.getElementById('snapshot-note-input').value = existing.note;
  confirmSnapshot(true);
  renderHistoryHeader();
}
```

- [ ] **Step 4: 在 `renderHistoryTab()` 中调用 `renderHistoryHeader()`**

在 `renderHistoryTab()` 函数开头添加：

```js
function renderHistoryTab() {
  renderHistoryHeader();  // <-- 新增
  const list = document.getElementById('snapshots-list');
  ...
}
```

- [ ] **Step 5: 移除备注弹窗中的拦截逻辑**（已在 Task 2 中处理，`confirmSnapshot` 非 overwrite 模式遇到已有记录会 toast 提示）

- [ ] **Step 6: 验证**

1. 首次打开 TAB → 看到「📸 记录本月数据」按钮
2. 记录后 → 变为「📅 2026年6月 已记录 ✓」+「覆盖更新」链接
3. 点击覆盖更新 → 确认 → 数据覆盖，状态不变
4. 下月再开 → 重新变为「📸 记录本月数据」

---

### Task 4: 快照列表——月度展示

**Files:**
- Modify: `index.html` (renderHistoryTab)

- [ ] **Step 1: 修改 `renderHistoryTab()` 中的列表渲染**

从：

```js
list.innerHTML = [...state.snapshots].sort((a, b) => new Date(b.date) - new Date(a.date)).map(s => {
  const d = new Date(s.date).toLocaleString('zh-CN');
  return `<div class="card flex items-center justify-between">
    <div class="flex-1 cursor-pointer" onclick="viewSnapshot('${s.id}')">
      <div class="font-medium text-sm">${d}</div>
      <div class="text-xs" style="color:var(--muted);">${esc(s.note) || '无备注'} · ${formatCNY(s.totalCNY)} · ${s.assets.length} 项资产</div>
    </div>
    <button onclick="deleteSnapshot('${s.id}')" class="btn-danger" ...>删除</button>
  </div>`;
}).join('');
```

改为：

```js
list.innerHTML = [...state.snapshots].sort((a, b) => b.month.localeCompare(a.month)).map(s => {
  return `<div class="card flex items-center justify-between">
    <div class="flex-1 cursor-pointer" onclick="viewSnapshot('${s.month}')">
      <div class="font-display font-bold text-sm">${monthLabel(s.month)}</div>
      <div class="text-xs mt-0.5" style="color:var(--muted);">
        ${esc(s.note) || '无备注'} · ${formatCNY(s.totalCNY)} · ${s.assets.length} 项资产
      </div>
    </div>
    <button onclick="deleteSnapshot('${s.month}')" class="btn-danger" style="padding:3px 8px;font-size:11px;">删除</button>
  </div>`;
}).join('');
```

注意：排序改为 `b.month.localeCompare(a.month)`，删除/查看用 `s.month` 代替 `s.id`。

- [ ] **Step 2: 验证**

列表中应显示「2026年6月」「2026年5月」等，不显示具体日期和时间

---

### Task 5: 图表——月度 X 轴

**Files:**
- Modify: `index.html`（renderHistoryChart）

- [ ] **Step 1: 修改 `renderHistoryChart()` 中的日期标签**

将：

```js
const dates = sorted.map(s => new Date(s.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));
```

改为：

```js
const dates = sorted.map(s => monthLabel(s.month));
```

- [ ] **Step 2: 修改空状态提示**

将：

```html
<p class="text-sm mt-1" style="color: var(--muted);">至少需要 2 次快照才能显示趋势</p>
```

改为：

```html
<p class="text-sm mt-1" style="color: var(--muted);">至少需要 2 个月的数据才能显示趋势</p>
```

- [ ] **Step 3: 验证**

图表 X 轴显示「2026年4月」「2026年5月」「2026年6月」等，tooltip 中的日期也改为月份

---

### Task 6: 查看详情 & 删除——使用 month 主键

**Files:**
- Modify: `index.html`（viewSnapshot, deleteSnapshot, snapshot-modal）

- [ ] **Step 1: 修改 `viewSnapshot()`**

将参数和查找逻辑：

从 `function viewSnapshot(id)` + `state.snapshots.find(s => s.id === id)`

改为：

```js
function viewSnapshot(month) {
  const snap = state.snapshots.find(s => s.month === month);
  if (!snap) return;
  document.getElementById('snapshot-modal-title').textContent = monthLabel(month) + ' 快照详情';
  ...
}
```

详情内容中的日期行改为月份：

```js
const date = monthLabel(snap.month);
```

- [ ] **Step 2: 修改 `deleteSnapshot()`**

从 `function deleteSnapshot(id)` → `function deleteSnapshot(month)`

```js
function deleteSnapshot(month) {
  if (!confirm('确认删除该月快照？')) return;
  state.snapshots = state.snapshots.filter(s => s.month !== month);
  saveState();
  renderHistoryTab();
  toast('快照已删除', 'success');
}
```

- [ ] **Step 3: 验证**

1. 点击某月卡片 → 弹出详情弹窗，标题显示「2026年6月 快照详情」
2. 删除某月记录 → 列表刷新，确认删除
