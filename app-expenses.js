let expenseTableOpen = false;

function toggleExpenseTable() {
  expenseTableOpen = !expenseTableOpen;
  applyExpenseTableState();
}

function applyExpenseTableState() {
  const wrap = document.getElementById('expense-table');
  const bar = document.getElementById('expense-table-toggle');
  if (!wrap || !bar) return;
  const wasHidden = wrap.style.display === 'none';
  wrap.style.display = expenseTableOpen ? '' : 'none';
  bar.setAttribute('aria-expanded', expenseTableOpen ? 'true' : 'false');
  // 刚显示出来的下拉才有布局，现在才量得到固有宽度（隐藏时量出来是 0，钉宽也就没钉上）
  if (expenseTableOpen && wasHidden) freezeSelectWidths();
}

// ========== EXPENSE CRUD ==========
// 设置消费日期值（兼容 Flatpickr 实例存在/不存在两种情况）
function setExpenseDate(dateStr) {
  const el = document.getElementById('expense-date');
  const fp = el._flatpickr;
  // 第二个参数 triggerChange 必须为 false：为 true 时 flatpickr 会把它当成「用户选了这一天」
  // 触发 onChange —— 而本项目在 onChange 里做了「选完即收起」，但同时 open() 会被拉起来，
  // 表现为**点「复制」弹窗一打开日历就自己展开**（用户要的是「默认今天，别弹」）。
  // 这里只是**写入初值**，不是用户交互，不该产生任何交互副作用。
  if (fp) { fp.setDate(dateStr, false); } else { el.value = dateStr; }
}
// ====== EXPENSE FILTER ======
// 筛选状态的唯一所有者：控件只写、渲染只读；失效值由 expense.normalizeExpenseFilters 丢弃（不靠「先重建下拉、再读值」）。
// 月份默认当月（最常看的一屏）；当月没有记录时它会在归一阶段被丢掉、回落「全部时间」。
let expenseFilters = { month: date.getCurrentMonth(), tag: '', query: '' };

// 唯一写入端：三个控件、空态「清除筛选」、搜索框内的 × / ESC 都走这里
function setExpenseFilter(patch) {
  expenseFilters = Object.assign({}, expenseFilters, patch);
  if (patch && patch.month) monthGridView = patch.month;
  renderExpenses();
}

// 状态 → 控件的唯一回写点。值相同时不写：搜索框每次按键都重跑渲染，回写会顶飞光标
function syncExpenseControls() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && el.value !== v) el.value = v;
  };
  set('expense-month-filter', expenseFilters.month);
  set('expense-tag-filter', expenseFilters.tag);
  set('expense-search', expenseFilters.query);
}

function populateExpenseMonthFilter() {
  fillMonthSelect('expense-month-filter', expense.expenseMonths(state.expenses));
}

// 标签筛选下拉：类别作 optgroup 分组头（不可选，仅分组），标签才是可选项；首项「全部标签」。
// 无标签的分类给 disabled 占位项，保住分组可见；失效选中值由归一阶段丢弃后回落「全部标签」
function populateExpenseTagFilter() {
  const sel = document.getElementById('expense-tag-filter');
  if (!sel) return;
  const groups = expense.expenseTagFilterGroups(state.expenseCategories);
  let opts = '<option value="">' + i18n.t('全部标签') + '</option>';
  for (const g of groups) {
    const tagOpts = g.tags.length
      ? g.tags.map(t => `<option value="${text.esc(expense.tagFilterValue(g.id, t))}">${text.esc(t)}</option>`).join('')
      : '<option value="" disabled>' + i18n.t('（暂无标签）') + '</option>';
    opts += `<optgroup label="${text.esc(g.name)}">${tagOpts}</optgroup>`;
  }
  setSelectOptions(sel, opts);
}

function clearExpenseFilters() {
  setExpenseFilter({ month: '', tag: '', query: '' });
}

function clearExpenseSearch() {
  setExpenseFilter({ query: '' });
  const el = document.getElementById('expense-search');
  if (el) el.focus();
}

function renderExpenses() {
  const rows = document.getElementById('expenses-rows');
  const empty = document.getElementById('expenses-empty');
  const list = document.getElementById('expenses-list');

  // 失效筛选值先归一（删了记录 / 分类 / 标签之后），再重建选项、回写控件。
  // 三步都由状态驱动：谁先谁后都不再影响结果
  expenseFilters = expense.normalizeExpenseFilters(expenseFilters, state.expenses, state.expenseCategories);
  populateExpenseMonthFilter();
  populateExpenseTagFilter();
  syncExpenseControls();

  // 结果、生效维度与空态判据同源（纯函数）：三段叠加与「哪种空态」不再各算一遍
  const view = expense.expenseListView(state.expenses, expenseFilters, state.expenseCategories);
  const filtered = view.rows;
  const q = view.active.query.toLowerCase();
  const searchClear = document.getElementById('expense-search-clear');
  if (searchClear) searchClear.style.display = q ? '' : 'none';
  const searchInput = document.getElementById('expense-search');
  if (searchInput) searchInput.classList.toggle('has-clear', !!q);

  if (filtered.length === 0) {
    empty.style.display = '';
    list.style.display = 'none';
    // 区分「完全无数据」「搜索无结果」与「筛选无记录」；判据全部来自 view，不另算一遍
    const titleEl = document.getElementById('expenses-empty-title');
    const subEl = document.getElementById('expenses-empty-sub');
    const demoBtn = document.getElementById('expenses-empty-demo');
    if (view.emptyKind === 'no-data') {
      titleEl.textContent = i18n.t('还没有消费记录');
      subEl.style.display = '';
      subEl.textContent = i18n.t('点击「记录消费」或导入示例数据开始');
      demoBtn.style.display = '';
    } else {
      const filterParts = [];
      if (view.active.query) filterParts.push(i18n.t('匹配「{p1}」', { p1: view.active.query }));
      if (view.active.tag) filterParts.push(view.active.tag);
      if (view.active.month) filterParts.push(date.monthLabel(view.active.month));
      titleEl.textContent = filterParts.length
        ? i18n.t('{p1}暂无消费记录', { p1: filterParts.join(' · ') })
        : i18n.t('暂无消费记录');
      subEl.style.display = view.active.query ? '' : 'none';
      subEl.textContent = i18n.t('换个关键词试试，或清除筛选');
      demoBtn.style.display = 'none';
    }
    document.getElementById('expenses-empty-clear').style.display = view.hasFilter ? '' : 'none';
  } else {
    empty.style.display = 'none';
    list.style.display = '';
    document.getElementById('expenses-empty-clear').style.display = 'none';
    let sorted = [...filtered];
    if (expenseSortBy) {
      const secondary = (a, b) => a.id < b.id ? (expenseSortDir === 'asc' ? -1 : 1)
        : a.id > b.id ? (expenseSortDir === 'asc' ? 1 : -1) : 0;
      sorted.sort((a, b) => compareBy(a, b, expenseSortBy, expenseSortDir, null, secondary));
    }
    updateSortIndicators('expense-sort-', ['date', 'amount'], expenseSortBy, expenseSortDir);
    rows.innerHTML = sorted.map(e => {
      const tagHtml = state.expenseCategories.map(cat => {
        const tagVal = e.tags[cat.id];
        return tagVal ? tagPillHtml(cat, tagVal, expenseCatColor, { keyHtml: text.highlightMatch(cat.name, q), valHtml: text.highlightMatch(tagVal, q) }) : '';
      }).join(' ');
      return `<div class="asset-row cols-expenses">
        <div class="t-body">${text.highlightMatch(e.date, q)}</div>
        <div class="t-body num">${money.money2(e.amount)}</div>
        <div class="t-body muted">${e.note ? text.highlightMatch(e.note, q) : '—'}</div>
        <div class="flex flex-wrap gap-1">${tagHtml}</div>
        <div class="row-actions">
          <button onclick="editExpense('${text.jsAttr(e.id)}')" class="row-btn edit">${i18n.t('编辑')}</button>
          <button onclick="duplicateExpense('${text.jsAttr(e.id)}')" class="row-btn copy">${i18n.t('复制')}</button>
          <button onclick="deleteExpense('${text.jsAttr(e.id)}')" class="row-btn danger">${i18n.t('删除')}</button>
        </div>
      </div>`;
    }).join('');
  }

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  renderMonthGrid();

  // 明细的范围（月份/标签/搜索）与笔数/合计必须写在同一行：它们是明细自己的读数，
  // 而不是页面的总数——摆到页头时，月份图说「本月 0 笔」而头顶写「34 笔」，两个读数互相打脸。
  const parts = [];
  if (view.active.month) parts.push(date.monthLabel(view.active.month));
  if (view.active.tag) parts.push(view.active.tag);
  if (q) parts.push(i18n.t('匹配'));

  const tableBar = document.getElementById('expense-table-toggle');
  const tableSummary = document.getElementById('expense-table-summary');
  if (tableBar) tableBar.style.display = state.expenses.length ? '' : 'none';
  if (tableSummary) {
    // 范围内部用空格、三段之间用中点："2026年1月 匹配 · 1 笔 · ¥3,200.00"
    tableSummary.textContent = [parts.join(' '), i18n.t('{n} 笔', { n: filtered.length }), money.formatCNY(total)]
      .filter(Boolean).join(' · ');
  }
  applyExpenseTableState();

  // 数据校验条跟随记录/分类变化（全局口径，不随列表筛选缩小）
  renderTagCheckBar('expense');
  syncDerivedReads(); // 与资产侧同一收尾口
}

function openExpenseModal(editId, prefillId, dayStr) {
  const modal = document.getElementById('expense-modal');
  const title = document.getElementById('expense-modal-title');
  const form = document.getElementById('expense-form');
  form.reset();
  document.getElementById('expense-edit-id').value = editId || '';
  setExpenseDate(dayStr || date.getLocalDateStr());

  const source = editId
    ? state.expenses.find(x => x.id === editId)
    : (prefillId ? state.expenses.find(x => x.id === prefillId) : null);

  if (editId) {
    title.textContent = i18n.t('编辑消费');
  } else if (prefillId) {
    title.textContent = i18n.t('复制消费');
  } else {
    title.textContent = i18n.t('记录消费');
  }

  if (source) {
    setExpenseDate(editId ? source.date : (dayStr || date.getLocalDateStr()));
    document.getElementById('expense-amount').value = money.moneyStr(source.amount);
    document.getElementById('expense-note').value = source.note || '';
  }

  document.getElementById('expense-tags-section').innerHTML = tagPickerHtml(
    state.expenseCategories,
    cat => source ? (source.tags[cat.id] || '') : '',
    'expense-tag-', expenseCatColor);

  openModal('expense-modal');
}

function saveExpense(e) {
  e.preventDefault();
  const editId = document.getElementById('expense-edit-id').value;
  const dateStr = document.getElementById('expense-date').value;
  const amount = money.parseMoneyInput(document.getElementById('expense-amount').value);
  const note = document.getElementById('expense-note').value.trim();

  if (!dateStr) { toast(i18n.t('请选择日期'), 'error'); return; }
  if (!amount || amount <= 0) { toast(i18n.t('金额必须大于 0'), 'error'); return; }

  const picked = collectPickedTags(state.expenseCategories, 'expense-tag-');
  const tags = picked.tags;

  if (!picked.complete) {
    toast(i18n.t('请为每个分类选择标签'), 'error');
    return;
  }

  if (editId) {
    const idx = state.expenses.findIndex(x => x.id === editId);
    if (idx >= 0) state.expenses[idx] = { ...state.expenses[idx], date: dateStr, amount, note, tags };
  } else {
    state.expenses.push({ id: genId(), date: dateStr, amount, note, tags });
  }

  saveState();
  // 记到筛选月份之外时跟过去，否则「已记录」的提示配一个纹丝不动的列表
  const savedMonth = dateStr.slice(0, 7);
  if (expenseFilters.month && expenseFilters.month !== savedMonth) setExpenseFilter({ month: savedMonth });
  else renderExpenses();
  closeModal('expense-modal');
  toast(editId ? i18n.t('消费已更新') : i18n.t('消费已记录'), 'success');
}

function editExpense(id) {
  openExpenseModal(id);
}

function duplicateExpense(id) {
  openExpenseModal('', id);
}

function deleteExpense(id) {
  showConfirm(i18n.t('确认删除该消费记录？'), () => {
    state.expenses = state.expenses.filter(e => e.id !== id);
    saveState();
    renderExpenses();
    toast(i18n.t('已删除'), 'success');
  });
}

let expenseSortTouched = false;

function toggleExpenseSort(field) {
  // 三态循环（状态机在 logic.js，与资产侧共用）：消费列表默认即日期降序（最新在前），
  // 首次点击保留旧行为（粘性翻转方向、不进入循环），此后才走标准三态循环
  const sticky = expenseSortBy === field && !expenseSortTouched;
  const r = ui.nextSortState(expenseSortBy, expenseSortDir, field, sticky);
  expenseSortBy = r.by;
  expenseSortDir = r.dir;
  if (sticky) expenseSortTouched = true;
  renderExpenses();
}

// ========== EXPENSE CATEGORY CRUD ==========
function expenseCatColor(catId, tagName) {
  return catColorImpl(state.expenseCategories, catId, tagName);
}

// ========== 消费数据校验（缺标签：一键批量 / 逐条点选）==========
// 打开时按分类捕获缺口记录 id；补齐后分组保留（✓ 徽章）以便逐条微调，重开时重新捕获。
// 写标签一律走 logic.js expense.setTag/expense.backfillTag，此处不直接赋值。
let tagCheckGroups = [];
// 面板同一时刻只服务一侧：两条校验条共用同一弹窗，按侧别取集合/色板/行内摘要
let tagCheckSide = 'expense';

// 校验面板的行内摘要（两侧结构一致、字段不同）：消费是日期/备注/金额，资产是名称与原币金额。
// 两函数保持同一套 class（.tagcheck-meta 是 flex 基准对齐容器，.tagcheck-note 负责截断）
function expenseTagCheckMeta(e) {
  return `<span class="t-micro muted">${text.esc((e.date || '').slice(5))}</span>`
    + `<span class="t-body tagcheck-note">${e.note ? text.esc(e.note) : '<span class="muted">' + i18n.t('（无备注）') + '</span>'}</span>`
    + `<span class="t-body tabular">${money.money2(e.amount)}</span>`;
}

function assetTagCheckMeta(a) {
  return `<span class="t-body tagcheck-note">${text.esc(a.name || i18n.t('（未命名）'))}</span>`
    + `<span class="t-body tabular">${money.money2(a.amount)} ${text.esc(a.currency || 'CNY')}</span>`;
}

// 校验条（资产/消费各一条）：唯一写入点，renderAssets / renderExpenses 各自重绘后调用
function renderTagCheckBar(side) {
  const cfg = CAT_SIDES[side];
  const bar = document.getElementById(cfg.tagCheckBar);
  if (!bar) return;
  const groups = expense.missingTagGroups(cfg.items(), cfg.cats());
  if (!groups.length) { bar.style.display = 'none'; return; }
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  bar.style.display = '';
  bar.querySelector('.tagcheck-text').innerHTML =
    `<b class="ink-accent">${total}</b>${i18n.t(' 条记录分类不完整 · 缺 ')}${groups.map(g => `「${text.esc(g.name)}」`).join('')}`;
}

function tagCheckGroupHtml(g) {
  const cfg = CAT_SIDES[tagCheckSide];
  const cat = cfg.cats().find(c => c.id === g.catId);
  if (!cat) return '';
  const items = g.ids.map(id => cfg.items().find(e => e.id === id)).filter(Boolean);
  const left = items.filter(e => expense.isUntaggedItem(e, g.catId, cat.tags));
  // 一键补齐选中态：组内取值唯一时盖印该标签（批量补齐后与逐条显示一致）
  const vals = [...new Set(items.map(e => (e.tags && e.tags[g.catId]) || ''))];
  const batchSel = vals.length === 1 && vals[0] ? vals[0] : '';
  const head = left.length
    ? `<span class="t-micro muted"><b>${left.length}</b> / ${items.length}${i18n.t(' 条待归类')}</span>`
    : `<span class="mo-badge up">${i18n.t('✓ 已补齐 {p1} 条', { p1: items.length })}</span>`;
  const rows = items.map(e => `<div class="tagcheck-row" data-eid="${text.esc(e.id)}">
      <div class="tagcheck-meta">${cfg.tagCheckMeta(e)}</div>
      <div>${tagPickerHtml([cat], () => (e.tags && e.tags[g.catId]) || '', `tagcheck-r-${e.id}-`, cfg.colorFn, { hideLabel: true })}</div>
    </div>`).join('');
  // 分组头分类名取 cat（会话对象 g 只有 catId/ids，用 g.name 会渲染成空串）
  return `<div class="tagcheck-group" data-catid="${text.esc(g.catId)}">
    <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
      <div class="flex items-center gap-2">
        <h4 class="card-title-sm">${text.esc(cat.name)}</h4>
        ${head}
      </div>
      ${left.length ? '<span class="t-micro muted">' + i18n.t('点标签即生效') + '</span>' : ''}
    </div>
    <div class="tagcheck-batch flex items-center gap-2 flex-wrap mb-1">
      <span class="t-micro muted">${i18n.t('一键补齐：')}</span>
      ${tagPickerHtml([cat], () => batchSel, `tagcheck-b-${g.catId}-`, cfg.colorFn, { hideLabel: true })}
    </div>
    <div>${rows}</div>
  </div>`;
}

function renderTagCheckPanel() {
  const box = document.getElementById('tagcheck-groups');
  const empty = document.getElementById('tagcheck-empty');
  const has = tagCheckGroups.length > 0;
  box.style.display = has ? '' : 'none';
  empty.style.display = has ? 'none' : '';
  box.innerHTML = has ? tagCheckGroups.map(tagCheckGroupHtml).join('') : '';
}

// 面板内单分组局部重绘（逐条/一键落值后刷新盖印、计数与 ✓ 徽章，不重建整个面板避免滚动跳动）
function renderTagCheckGroup(catId) {
  const box = document.getElementById('tagcheck-groups');
  const idx = tagCheckGroups.findIndex(g => g.catId === catId);
  if (idx < 0) return;
  const html = tagCheckGroupHtml(tagCheckGroups[idx]);
  const el = box.children[idx];
  if (el && html) el.outerHTML = html;
}

function openTagCheck(side, catId) {
  const cfg = CAT_SIDES[side];
  tagCheckSide = side;
  tagCheckGroups = expense.missingTagGroups(cfg.items(), cfg.cats())
    .filter(g => !catId || g.catId === catId)
    .map(g => ({ catId: g.catId, ids: g.items.map(i => i.id) }));
  // 顶部说明按侧别换（资产侧必须说清历史快照不随补，否则会以为历史图表也会跟着变）
  document.getElementById('tagcheck-hint').textContent = cfg.tagCheckHint();
  renderTagCheckPanel();
  openModal('tagcheck-modal');
}

// 面板事件委托（容器 onclick）：选中值由 selectTagChoice 先写入 hidden input，再气泡到这里
// row = 逐条点选（可改本次会话已选值）；batch = 一键补齐（只写仍缺的位置）
// 集合与分类都按 tagCheckSide 取，面板本身不认资产/消费。
function onTagCheckPick(e) {
  const cfg = CAT_SIDES[tagCheckSide];
  const chip = e.target && e.target.closest ? e.target.closest('.tag-picker .tag-choice') : null;
  if (!chip) return;
  const picker = chip.closest('.tag-picker');
  const input = picker && document.getElementById(picker.dataset.target);
  if (!input) return;
  const val = input.value;
  const row = chip.closest('.tagcheck-row');
  const host = row || chip.closest('.tagcheck-batch');
  if (!host) return;
  const catEl = host.closest('.tagcheck-group');
  const catId = catEl && catEl.dataset.catid;
  const cat = cfg.cats().find(c => c.id === catId);
  const g = tagCheckGroups.find(x => x.catId === catId);
  if (!cat || !g) return;
  // 再点已选项 = 取消选择：数据不变，按数据回滚盖印状态（面板不提供取消归类）
  if (!val) { renderTagCheckGroup(catId); return; }

  let n = 0;
  if (row) {
    const rec = cfg.items().find(x => x.id === row.dataset.eid);
    if (!rec) return;
    expense.setTag(rec, catId, val);
    n = 1;
  } else {
    const items = g.ids.map(id => cfg.items().find(x => x.id === id)).filter(Boolean);
    n = expense.backfillTag(items, catId, val, cat.tags);
    if (!n) return;
  }
  saveState();
  cfg.renderItems();      // 列表 pill 与校验条同步（两侧各自重绘自己的列表）
  renderTagCheckGroup(catId);
  toast(n > 1 ? i18n.t('已为 {p1} 条记录打上「{p2}」', { p1: n, p2: val }) : i18n.t('已归入「{p1}」', { p1: val }), 'success');
}

// ========== EXPENSE CHART ==========
let expenseChart = null;

function populateExpenseChartSelects() {
  fillCategorySelect('expense-chart-category-select', state.expenseCategories);

  const months = expense.expenseMonths(state.expenses);
  const monthSel = fillMonthSelect('expense-chart-month-select', months);
  if (monthSel && !monthSel.value && months.length > 0) monthSel.value = months[0];
}

async function renderExpenseChart() {
  const catId = document.getElementById('expense-chart-category-select').value;
  const monthFilter = document.getElementById('expense-chart-month-select').value;

  const chartEl = document.getElementById('expense-sunburst-chart');
  const emptyEl = document.getElementById('expense-chart-empty');
  const totalEl = document.getElementById('expense-chart-total');

  const filtered = monthFilter
    ? state.expenses.filter(e => e.date.slice(0, 7) === monthFilter)
    : state.expenses;

  // 无分类（select 无选项）或当月无数据时都显示空态，避免空白画布
  if (!catId || filtered.length === 0) {
    showChartOrEmpty(chartEl, emptyEl, false);
    hideChartTotal(totalEl);
    renderSunburstLegend('expense-chart-legend', [], 0, null);
    return;
  }
  showChartOrEmpty(chartEl, emptyEl, true);

  const cat = state.expenseCategories.find(c => c.id === catId);
  if (!cat) { hideChartTotal(totalEl); return; }

  const groups = {};
  cat.tags.forEach(t => { groups[t] = []; });
  filtered.forEach(e => {
    const tagVal = e.tags[catId];
    if (tagVal && groups[tagVal]) {
      const key = e.note || e.date;
      const existing = groups[tagVal].find(c => c.name === key);
      if (existing) existing.value += e.amount;
      else groups[tagVal].push({ name: key, value: e.amount });
    }
  });

  // 与资产侧同一个纯函数（消费金额本身是 CNY，汇率按 1 折算）——两页不得各 reduce 一遍
  const total = money.sumAmountCNY(filtered, null);

  const data = chartData.buildSunburstData(cat, groups, c => c.value);

  // 所选维度下所有分组均为空（如新建分类后消费尚未分配标签）时显示空态, 避免空白画布
  if (data.length === 0) {
    showChartOrEmpty(chartEl, emptyEl, false);
    hideChartTotal(totalEl);
    renderSunburstLegend('expense-chart-legend', [], 0, null);
    return;
  }

  // 图与清单同源：下钻后分母换成该分类合计（与卡片总数、tooltip、清单三处同口径）
  const view = chartData.sunburstDrillView(data, total, sunburstLegendSel['expense-chart-legend']);
  renderChartTotal(totalEl, view.total);

  const th = chartTheme();
  if (!(await chartApply({
    slot: chartSlot(() => expenseChart, v => expenseChart = v),
    el: chartEl,
    wire: c => wireSunburstDrill(c, 'expense-chart-legend'),
    option: buildSunburstOption(view.data, p => sunburstTooltipContent(p, th, view.total)),
  }))) return;
  // 重绘回调登记的是**整个渲染函数**：下钻既换清单也换图，只重绘清单会让图留在上一层
  sunburstRerender['expense-chart-legend'] = renderExpenseChart;
  renderSunburstLegend('expense-chart-legend', view.data, view.total, expenseChart);
}

// ========== EXPENSE TREND ==========
let expenseTrendChart = null;
// 堆叠柱下钻与图例记忆（消费趋势），与历史净值同构：
// trendLegendSel 由原生 legendselectchanged 维护，重绘时经 chartData.pruneLegendSelected 清理后回灌
//（非破坏性：原始映射不回写，切换分类再切回可恢复原选中态）；
// trendDrillMeta 存当前渲染上下文，供 wireStackedBarDrill 反查「月份 × 标签」
let trendLegendSel = {};
let trendDrillMeta = null;

function setExpenseTrendMode(mode) {
  expenseTrendMode = mode;
  setSegMode('expense-trend-mode-value', 'expense-trend-mode-percent', mode, 'value', 'percent', renderExpenseTrendChart);
}

// ========== EXPECTATION (消费趋势参考线) ==========
function openExpectationModal() {
  document.getElementById('expectation-input').value = money.moneyStr(state.expenseExpectation);
  openModal('expectation-modal');
}
function saveExpectation() {
  const v = money.parseMoneyInput(document.getElementById('expectation-input').value);
  if (!v || v <= 0) { toast(i18n.t('请输入有效的预期消费金额'), 'error'); return; }
  const hadValue = (state.expenseExpectation || 0) > 0;
  state.expenseExpectation = v;
  saveState();
  closeModal('expectation-modal');
  renderAssets();
  toast(hadValue ? i18n.t('预期消费已更新') : i18n.t('预期消费已设置'), 'success');
}
function clearExpectation() {
  showConfirm(i18n.t('确认清除预期月消费？'), () => {
    state.expenseExpectation = 0;
    saveState();
    closeModal('expectation-modal');
    renderAssets(); // 同上：收尾在 syncDerivedReads
    toast(i18n.t('已清除预期消费'), 'success');
  });
}

async function renderExpenseTrendChart() {
  // 读数卡跟着「预期月消费」走: 放在早退之前, 无消费记录时也照样同步（口径与本页记录无关）
  renderRunwayRow();
  renderMonthPace();
  const expBtn = document.getElementById('expense-expectation-btn');
  if (expBtn) {
    const exp = state.expenseExpectation || 0;
    expBtn.textContent = exp > 0
      ? i18n.t('预期 ¥') + exp.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
      : i18n.t('设定预期');
    expBtn.style.color = exp > 0 ? 'var(--accent-ink)' : '';
  }

  const catId = document.getElementById('expense-trend-category-select').value;
  const chartEl = document.getElementById('expense-trend-chart');
  const emptyEl = document.getElementById('expense-trend-empty');

  const cat = state.expenseCategories.find(c => c.id === catId);

  if (state.expenses.length === 0 || !cat) { trendDrillMeta = null; showChartOrEmpty(chartEl, emptyEl, false); return; }
  showChartOrEmpty(chartEl, emptyEl, true);

  const th = chartTheme();
  const expectation = state.expenseExpectation || 0;
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
  const dates = sorted.map(m => date.monthLabel(m));

  const totals = sorted.map(m => {
    return cat.tags.reduce((s, tag) => s + (monthMap[m][tag] || 0), 0);
  });

  // 标签顺序按跨月合计降序（大的放堆叠柱底部，小的在上），口径与历史净值同源
  const sortedTags = chartData.sortTagsByTotal(cat, sorted.map(m => monthMap[m]));

  trendDrillMeta = {
    catId: catId,
    months: sorted,
    tags: sortedTags,
  };

  const tagSeries = sortedTags.map((tag) => {
    const raw = sorted.map(m => monthMap[m][tag] || 0);
    const data = expenseTrendMode === 'percent'
      ? chartData.percentSeriesData(raw, totals)
      : raw;
    return { ...barSeriesStyle(cat, tag), data };
  });

  // 透明「合计」系列：仅用于在堆叠柱顶部展示当前可见各项之和
  // 不占高度、不参与图例，随 legend 选中状态实时重算
  // 金额模式下叠加「预期消费」水平参考线, 超线月份的柱顶 label 标红加 ▲
  const totalSeries = expenseTrendMode === 'value' ? [{
    name: TOTAL_SERIES_NAME, type: 'bar', stack: 'total',
    data: sorted.map(() => 0),
    itemStyle: { color: 'transparent' },
    emphasis: { disabled: true },
    z: 10,
    label: {
      show: true,
      position: 'top',
      formatter: function(p) {
        const opt = expenseTrendChart && expenseTrendChart.getOption();
        const selected = (opt && opt.legend && opt.legend[0] && opt.legend[0].selected) || {};
        const m = sorted[p.dataIndex];
        const visTotal = cat.tags.reduce((s, tag) =>
          selected[tag] === false ? s : s + (monthMap[m][tag] || 0), 0);
        if (expectation > 0 && visTotal > expectation) {
          return '{red|▲ ' + money.formatCNY(visTotal) + '}';
        }
        return money.formatCNY(visTotal);
      },
      rich: {
        red: { color: th.down, fontFamily: CHART_FONT, fontSize: 11, fontWeight: 600 },
      },
      fontFamily: CHART_FONT,
      fontSize: 11,
      color: th.muted,
    },
    // 预期消费参考线（仅金额模式；占比模式 y 轴为百分比, 不显示）
    markLine: expectation > 0 ? {
      silent: true,
      symbol: ['none', 'none'],
      lineStyle: { color: th.accent, type: 'dashed', width: 1.5 },
      label: {
        formatter: i18n.t('预期 ') + money.formatCNY(expectation) + i18n.t('/月'),
        position: 'insideEndTop',
        color: th.fg,
        fontSize: 11,
        fontFamily: CHART_FONT,
        backgroundColor: th.card,
        borderColor: th.line,
        borderWidth: 1,
        borderRadius: 3,
        padding: [2, 6],
      },
      data: [{ yAxis: expectation }],
    } : undefined,
  }] : [];

  const series = tagSeries.concat(totalSeries);

  const option = {
    // 回灌前清理失效项（局部副本，不回写存储）
    ...barChartBase(th, dates, expenseTrendMode, sortedTags, chartData.pruneLegendSelected(trendLegendSel, sortedTags)),
    tooltip: {
      ...chartTooltipBase(th),
      confine: true,
      // 始终置于鼠标下方偏右，避免遮挡堆叠柱顶部的合计 label
      position: function(point, params, dom, rect, size) {
        const w = dom.offsetWidth, h = dom.offsetHeight;
        let x = point[0] + 15;
        let y = point[1] + 18;
        if (y + h > size.viewSize[1]) y = point[1] - h - 18;
        if (x + w > size.viewSize[0]) x = point[0] - w - 15;
        if (x < 5) x = 5;
        return [x, y];
      },
      // item 模式下只在 hover 到柱子实体时触发（空白处不弹），
      // 只展示当前项名称、数值与百分比
      formatter: function(p) {
        if (!p || p.seriesName === TOTAL_SERIES_NAME) return ''; // 透明承载系列不响应
        const idx = p.dataIndex;
        const d = dates[idx];
        const total = totals[idx];
        if (expenseTrendMode === 'percent') {
          const raw = p.data && p.data.raw != null ? p.data.raw : 0;
          const pct = money.pctStr(raw, total);
          return `<b>${d}</b><br/>${p.marker} ${text.esc(p.seriesName)}: ${money.formatCNY(raw)} (${pct}%)`;
        }
        const pct = money.pctStr(p.value, total);
        return `<b>${d}</b><br/>${p.marker} ${text.esc(p.seriesName)}: ${money.formatCNY(p.value)} (${pct}%)`;
      }
    },
    series
  };
  if (!(await chartApply({
    slot: chartSlot(() => expenseTrendChart, v => expenseTrendChart = v),
    el: chartEl,
    wire: c => {
      // 图例选中态记忆：用户点击图例隐藏/显示系列时保存，重绘后回灌（切模式/切主题不丢）
      c.on('legendselectchanged', p => { trendLegendSel = p.selected; });
      wireStackedBarDrill(c, () => trendDrillMeta, viewExpenseSegment);
    },
    option: option,
  }))) return;
  renderExpenseTrendList();
}

function renderExpenseTrendList() {
  const list = document.getElementById('expense-trend-list');
  const months = expense.monthlyExpenseTotals(state.expenses);
  if (months.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = [...months].reverse().map(({ month, total, count }) => {
    const prevMonth = expense.prevExpenseMonthOf(month, months);
    const prevTotal = prevMonth ? months.find(x => x.month === prevMonth).total : null;
    const { badge, diffLine } = momCompareHtml(total, prevTotal, false);
    return `<div class="card card-interactive flex items-center justify-between">
      <div class="flex-1 row-hit" role="button" tabindex="0" onclick="viewExpenseMonth('${text.jsAttr(month)}')"
        onkeydown="if(ui.activateKeyAction(event.key)){event.preventDefault();viewExpenseMonth('${text.jsAttr(month)}');}">
        <div class="flex items-center gap-2">
          <span class="t-medium t-body">${date.monthLabel(month)}</span>
          ${badge}
        </div>
        <div class="t-micro mt-0.5 muted">${money.formatCNY(total)} · ${i18n.t('{p1} 条消费记录', { p1: count })}${diffLine ? ' · ' + diffLine : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function openExpenseCompareModal() {
  const months = expense.monthlyExpenseTotals(state.expenses);
  if (months.length < 2) { toast(i18n.t('至少需要两个月的消费记录才能对比'), 'error'); return; }
  const monthStrs = months.map(m => m.month);
  const baseSel = document.getElementById('exp-compare-base-select');
  const targetSel = document.getElementById('exp-compare-target-select');
  const catSel = document.getElementById('exp-compare-cat-select');
  const trendCat = document.getElementById('expense-trend-category-select').value;
  catSel.innerHTML = state.expenseCategories.map(c => `<option value="${c.id}">${text.esc(c.name)}</option>`).join('');
  catSel.value = state.expenseCategories.some(c => c.id === trendCat) ? trendCat : (state.expenseCategories[0] && state.expenseCategories[0].id) || '';
  baseSel.innerHTML = date.monthsDesc(monthStrs).map(m => `<option value="${m}">${date.monthLabel(m)}</option>`).join('');
  targetSel.innerHTML = date.monthsDesc(monthStrs).map(m => `<option value="${m}">${date.monthLabel(m)}</option>`).join('');
  baseSel.value = monthStrs[monthStrs.length - 2];
  targetSel.value = monthStrs[monthStrs.length - 1];
  openModal('expense-compare-modal');
  renderExpenseCompareTable();
}

function renderExpenseCompareTable() {
  const base = document.getElementById('exp-compare-base-select').value;
  const target = document.getElementById('exp-compare-target-select').value;
  const catId = document.getElementById('exp-compare-cat-select').value;
  const heroEl = document.getElementById('exp-compare-hero');
  const ctxEl = document.getElementById('exp-compare-context');
  const container = document.getElementById('exp-compare-detail-content');
  const cat = state.expenseCategories.find(c => c.id === catId);
  if (!base || !target || !cat) { container.innerHTML = ''; return; }

  const months = expense.monthlyExpenseTotals(state.expenses);
  const baseTotal = (months.find(m => m.month === base) || { total: 0 }).total;
  const compTotal = (months.find(m => m.month === target) || { total: 0 }).total;
  const diff = compTotal - baseTotal;
  // 消费语义：上涨=红(警示)、下降=绿(良好)，与 momCompareHtml(goodWhenUp=false) 一致
  renderCompareHero(heroEl, ctxEl, diff, baseTotal, compTotal, date.monthLabel(base), date.monthLabel(target), false);

  const baseMap = expense.expenseMonthTagTotals(base, catId, state.expenses);
  const compMap = expense.expenseMonthTagTotals(target, catId, state.expenses);
  const rows = cat.tags.map(tag => {
    const av = baseMap[tag] || 0;
    const bv = compMap[tag] || 0;
    return { tag, av, bv, d: bv - av, p: av > 0 ? (bv - av) / av * 100 : null };
  });

  if (rows.length === 0) {
    container.innerHTML = '<p class="text-center py-8 t-body muted">' + i18n.t('该维度下暂无标签') + '</p>';
    return;
  }

  container.innerHTML = compareTableHtml(rows, {
    firstLabel: i18n.t('分类标签'),
    periods: [i18n.t('期初月'), i18n.t('期末月')],
    color: v => compareColor(v, false),
    firstCellHtml: r => tagPillHtml(cat, r.tag, expenseCatColor, { showKey: false }),
  });
}

function viewExpenseMonth(month) {
  const expenses = state.expenses.filter(e => e.date.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date));
  if (expenses.length === 0) return;
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  openDetail({
    title: i18n.t('月度消费明细'),
    summary: `${date.monthLabel(month)} | ${i18n.t('总消费: ')}<strong>${money.formatCNY(total)}</strong> · ${i18n.t('{p1} 笔记录', { p1: expenses.length })}`,
    cols: 'cols-expense-month',
    head: [{ html: i18n.t('日期') }, { html: i18n.t('金额'), cls: 'num' }, { html: i18n.t('备注') }, { html: i18n.t('标签') }],
    rows: expenses.map(e => ([
      { cls: 't-body', html: text.esc(e.date) },
      { cls: 't-body num', html: money.money2(e.amount) },
      { cls: 't-body muted', html: e.note ? text.esc(e.note) : '—' },
      {
        cls: 'flex flex-wrap gap-1',
        html: state.expenseCategories.map(cat => {
          const tagVal = e.tags[cat.id];
          return tagVal ? tagPillHtml(cat, tagVal, expenseCatColor) : '';
        }).join(' '),
      },
    ])),
    empty: i18n.t('该月没有消费记录'),
  });
}
function viewExpenseSegment(month, catId, tag) {
  const cat = state.expenseCategories.find(c => c.id === catId);
  if (!cat) return;
  const items = state.expenses
    .filter(e => e.date.slice(0, 7) === month && (e.tags || {})[catId] === tag)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (items.length === 0) return;
  const segTotal = items.reduce((s, e) => s + e.amount, 0);
  openDetail({
    title: date.monthLabel(month) + ' · ' + tag + i18n.t('构成'),
    summary: `${text.esc(cat.name)} › ${text.esc(tag)} | ${i18n.t('{p1} 笔记录 | 合计 ', { p1: items.length })}<strong>${money.formatCNY(segTotal)}</strong>`,
    cols: 'cols-expense-segment',
    head: [{ html: i18n.t('日期') }, { html: i18n.t('金额'), cls: 'num' }, { html: i18n.t('占比'), cls: 'num' }, { html: i18n.t('备注') }],
    rows: items.map(e => ([
      { cls: 't-body', html: text.esc(e.date) },
      { cls: 't-body num', html: money.money2(e.amount) },
      { cls: 't-body num muted', html: `${money.pctStr(e.amount, segTotal)}%` },
      { cls: 't-body muted', html: e.note ? text.esc(e.note) : '—' },
    ])),
    empty: i18n.t('该标签下没有消费记录'),
  });
}
function loadExpenseDemoData() {
  if (state.expenses.length > 0) {
    showConfirm(i18n.t('导入示例数据将覆盖当前所有消费数据，确认继续？'), () => doLoadExpenseDemoData());
    return;
  }
  doLoadExpenseDemoData();
}
function doLoadExpenseDemoData() {
  // 数据形状在 logic.js demo.expenseDemo（纯函数、可单测）；这里只留赋值 → 落盘 → 重绘。
  // 已有内置「消费类别」原样沿用（不新建第二份），由纯函数按传入的分类决定。
  const expenseTypeCat = state.expenseCategories.find(c => c.id === 'expense-type');
  const data = demo.expenseDemo({ now: new Date(), genId, expenseTypeCat });
  state.expenseCategories = data.expenseCategories;
  state.expenses = data.expenses;
  saveState();
  renderExpenses();
  renderCategoryCards('expense');
  toast(i18n.t('示例消费数据已导入（') + 6 + i18n.t('个月）'), 'success');
}


