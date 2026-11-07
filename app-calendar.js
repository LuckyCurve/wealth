let monthGridMode = 'count';
let monthGridView = null;
let selectedDay = '';
const DAY_PRESS_MS = 450;
let dayPress = null;
let pressFiredAt = 0;

function renderMonthGrid() {
  const grid = document.getElementById('month-grid');
  if (!grid) return;
  const month = monthGridView || date.getCurrentMonth();
  const view = monthGrid.build(state.expenses, month, monthGridMode, date.getLocalDateStr());
  if (!view) {
    grid.innerHTML = '';
    renderDayPanel();
    return;
  }
  const label = document.getElementById('month-grid-label');
  const summary = document.getElementById('month-grid-summary');
  if (label) label.textContent = date.monthLabel(month);
  if (summary) {
    const parts = [i18n.t('{n} 笔', { n: view.count })];
    if (view.amount > 0) parts.push(money.formatCNY(view.amount));
    const gap = month === date.getCurrentMonth() ? expense.gapDays(state.expenses, date.getLocalDateStr()) : null;
    const limit = expense.normalizeGapDays(state.expenseGapDays);
    if (gap != null && limit > 0 && gap >= limit) parts.push(i18n.t('已连续 {n} 天没有记录', { n: gap }));
    summary.textContent = parts.join(' · ');
  }
  if (selectedDay && selectedDay.slice(0, 7) !== month) selectedDay = '';
  const today = date.getLocalDateStr();
  grid.innerHTML = view.weeks.map(week => week.map(cell => {
    if (!cell) return '<span class="mg-cell is-blank"></span>';
    const label = monthGrid.cellText(cell);
    const value = monthGrid.cellValue(cell, monthGridMode);
    const at = (cell.date === today ? ' is-today' : '') + (cell.date === selectedDay ? ' is-selected' : '');
    const click = cell.future ? ' disabled' : ` data-date="${cell.date}" onclick="selectDay('${cell.date}')"`;
    return `<button type="button" class="mg-cell${at}" data-lv="${cell.level}"${click} title="${text.esc(label)}" aria-label="${text.esc(label)}"><span class="mg-day">${cell.day}</span><span class="mg-val">${text.esc(value)}</span></button>`;
  }).join('')).join('');
  renderDayPanel();
}

function selectDay(dayStr) {
  if (pressFiredAt && performance.now() - pressFiredAt < 700) return;
  if (selectedDay === dayStr) {
    selectedDay = '';
    renderMonthGrid();
    return;
  }
  if (!monthGrid.dayEntries(state.expenses, dayStr).length) {
    recordOnDay(dayStr);
    return;
  }
  selectedDay = dayStr;
  renderMonthGrid();
}

function recordOnDay(dateStr) {
  openExpenseModal(null, null, dateStr);
}

function renderDayPanel() {
  const box = document.getElementById('day-panel');
  if (!box) return;
  const items = selectedDay ? monthGrid.dayEntries(state.expenses, selectedDay) : [];
  if (!items.length) {
    selectedDay = '';
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const total = items.reduce((sum, e) => sum + e.amount, 0);
  const head = monthGrid.cellText({
    date: selectedDay,
    day: Number(selectedDay.slice(8)),
    count: items.length,
    amount: total,
  });
  const rows = items.map(e => {
    const tagHtml = state.expenseCategories
      .map(cat => (e.tags[cat.id] ? tagPillHtml(cat, e.tags[cat.id], expenseCatColor) : ''))
      .join(' ');
    return [
      { cls: 't-body num', html: money.money2(e.amount) },
      { cls: 't-body muted', html: e.note ? text.esc(e.note) : '—' },
      { cls: 'flex flex-wrap gap-1', html: tagHtml },
      {
        cls: 'flex gap-2 justify-end',
        html: `<button onclick="editExpense('${text.jsAttr(e.id)}')" class="row-btn edit">${i18n.t('编辑')}</button>`
          + `<button onclick="duplicateExpense('${text.jsAttr(e.id)}')" class="row-btn copy">${i18n.t('复制')}</button>`
          + `<button onclick="deleteExpense('${text.jsAttr(e.id)}')" class="row-btn danger">${i18n.t('删除')}</button>`,
      },
    ];
  });
  box.style.display = '';
  box.innerHTML = `<div class="day-panel-head">
      <span class="t-body">${text.esc(head)}</span>
      <div class="day-panel-actions">
        <button type="button" class="btn-ghost btn-xs" onclick="exportDayReceipt('${selectedDay}')">${i18n.t('小票')}</button>
        <button type="button" class="btn-ghost btn-xs" onclick="recordOnDay('${selectedDay}')">${i18n.t('＋ 记录消费')}</button>
      </div>
    </div>`
    + detailTableHtml('cols-day', [
      { cls: 'num', html: i18n.t('金额') },
      { html: i18n.t('备注') },
      { html: i18n.t('标签') },
      { html: '' },
    ], rows);
}

function setMonthGridMode(mode) {
  monthGridMode = mode === 'amount' ? 'amount' : 'count';
  setSegMode('mg-mode-count', 'mg-mode-amount', monthGridMode, 'count', 'amount', renderMonthGrid);
}

function shiftMonthGrid(n) {
  monthGridView = date.addMonths(monthGridView || date.getCurrentMonth(), n);
  renderMonthGrid();
}

function startDayPress(dateStr, cell) {
  cancelDayPress();
  dayPress = { date: dateStr, cell: cell, timer: setTimeout(fireDayPress, DAY_PRESS_MS) };
  cell.classList.add('pressing');
}

function fireDayPress() {
  if (!dayPress) return;
  const dateStr = dayPress.date;
  pressFiredAt = performance.now();
  cancelDayPress();
  recordOnDay(dateStr);
}

function cancelDayPress() {
  if (!dayPress) return;
  clearTimeout(dayPress.timer);
  if (dayPress.cell) dayPress.cell.classList.remove('pressing');
  dayPress = null;
}

(function wireMonthGrid() {
  const grid = document.getElementById('month-grid');
  if (!grid) return;
  const cellOf = (e) => (e.target && e.target.closest ? e.target.closest('.mg-cell[data-date]') : null);
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const cell = cellOf(e);
    if (cell) startDayPress(cell.dataset.date, cell);
  });
  grid.addEventListener('pointerup', cancelDayPress);
  grid.addEventListener('pointercancel', cancelDayPress);
  grid.addEventListener('pointerleave', cancelDayPress);
  grid.addEventListener('pointermove', (e) => {
    if (!dayPress || !dayPress.cell) return;
    const r = dayPress.cell.getBoundingClientRect();
    if (e.clientX < r.left - 4 || e.clientX > r.right + 4 || e.clientY < r.top - 4 || e.clientY > r.bottom + 4) cancelDayPress();
  });
  grid.addEventListener('contextmenu', (e) => {
    const cell = cellOf(e);
    if (!cell) return;
    e.preventDefault();
    recordOnDay(cell.dataset.date);
  });
})();
