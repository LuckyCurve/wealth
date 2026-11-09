let yieldDraft = null;
let yieldView = 'list';

function yieldItems() {
  if (!state.yieldCalc || typeof state.yieldCalc !== 'object') state.yieldCalc = {};
  state.yieldCalc.items = annualize.normalizeItems(state.yieldCalc.items);
  return state.yieldCalc.items;
}

function newYieldDraft() {
  return { id: genId(), name: '', rows: annualize.normalizeRows([], annualize.MAX_ROWS) };
}

function yieldDisposePickers() {
  document.querySelectorAll('#yield-rows input').forEach(el => {
    if (el._flatpickr) el._flatpickr.destroy();
  });
}

function renderYieldModal() {
  const host = document.getElementById('yield-body');
  if (!host) return;
  yieldDisposePickers();
  if (yieldView === 'edit' && !yieldDraft) yieldDraft = newYieldDraft();
  host.innerHTML = yieldView === 'edit' ? yieldEditHtml() : yieldListHtml();
  if (yieldView === 'edit') renderYieldRows();
  renderYieldResult();
}

function openYieldModal() {
  renderYieldModal();
  openModal('yield-modal');
}

function yieldListHtml() {
  const items = yieldItems();
  const rows = items.map(item => {
    const r = annualize.summarize(item.rows);
    const points = r.points;
    const range = points.length >= 2 ? points[0].date + ' → ' + points[points.length - 1].date : '';
    const days = r.total ? ' · ' + i18n.t('{p1} 天', { p1: r.total.days }) : '';
    const annual = r.total ? yieldPct(r.total.compoundPct) : '—';
    const color = compareColor((r.total && r.total.compoundPct) || 0, true);
    return `<button type="button" class="yield-item" onclick="yieldEditItem('${text.esc(item.id)}')">
      <span class="yield-item-name">${text.esc(item.name.trim() || i18n.t('未命名'))}</span>
      <span class="t-micro muted tabular">${text.esc(range)}${days}</span>
      <span class="tabular t-medium" style="color:${color};">${annual}</span>
    </button>`;
  }).join('');
  return `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <p class="t-body muted" style="margin:0;">${i18n.t('保存的换算随备份一起导出')}</p>
      <button type="button" class="btn-gold" onclick="yieldNewItem()">${i18n.t('＋ 新建记录')}</button>
    </div>
    ${items.length
      ? `<div class="yield-list">${rows}</div>`
      : `<p class="t-body muted" style="margin:24px 0 0;">${i18n.t('还没有记录 · 点「新建记录」，填两个时点的净值')}</p>`}
    <div class="modal-footer">
      <button type="button" onclick="closeModal('yield-modal')" class="btn-ghost">${i18n.t('关闭')}</button>
    </div>`;
}

function yieldNewItem() {
  yieldDraft = newYieldDraft();
  yieldView = 'edit';
  renderYieldModal();
  const name = document.getElementById('yield-name');
  if (name) name.focus();
}

function yieldEditItem(id) {
  const item = yieldItems().find(it => it.id === id);
  if (!item) return;
  yieldDraft = { id: item.id, name: item.name, rows: annualize.normalizeRows(item.rows) };
  yieldView = 'edit';
  renderYieldModal();
  const name = document.getElementById('yield-name');
  if (name) name.focus();
}

function yieldBackToList() {
  yieldDraft = null;
  yieldView = 'list';
  renderYieldModal();
}

function yieldResetView() {
  yieldDraft = null;
  yieldView = 'list';
}

function yieldEditHtml() {
  const d = yieldDraft || newYieldDraft();
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <button type="button" class="btn-ghost btn-sm" onclick="yieldBackToList()">‹ ${i18n.t('全部记录')}</button>
    </div>
    <div style="margin-top:16px;">
      <label class="field-label" for="yield-name">${i18n.t('名称（可选）')}</label>
      <input type="text" id="yield-name" style="width:100%;" value="${text.esc(d.name)}" autocomplete="off" oninput="yieldNameInput(this.value)">
    </div>
    <div id="yield-rows" style="margin-top:16px;"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;">
      <button type="button" id="yield-add" class="btn-ghost btn-sm" onclick="yieldAddRow()">${i18n.t('＋ 再加一个时点')}</button>
      <button type="button" class="btn-ghost btn-sm" onclick="yieldClear()">${i18n.t('清空')}</button>
    </div>
    <p class="t-micro muted" style="margin:12px 0 0;">${i18n.t('只有累计收益率时，把 1 + 收益率 填进净值（3.2% 填 1.032）')}</p>
    <div id="yield-result" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--rule);"></div>
    <div class="modal-footer">
      ${yieldSavedRecord() ? `<button type="button" class="btn-danger" onclick="yieldDelete()">${i18n.t('删除')}</button>` : ''}
      <button type="button" onclick="closeModal('yield-modal')" class="btn-ghost">${i18n.t('取消')}</button>
      <button type="button" class="btn-gold" onclick="yieldSave()">${i18n.t('保存')}</button>
    </div>`;
}

function yieldSavedRecord() {
  if (!yieldDraft) return null;
  return yieldItems().find(it => it.id === yieldDraft.id) || null;
}

function yieldRows() {
  if (!yieldDraft) yieldDraft = newYieldDraft();
  yieldDraft.rows = annualize.normalizeRows(yieldDraft.rows, annualize.MAX_ROWS);
  return yieldDraft.rows;
}

function yieldNameInput(value) {
  if (yieldDraft) yieldDraft.name = value;
}

function yieldUpdate(i, field, value) {
  const rows = yieldRows();
  if (!rows[i]) return;
  rows[i][field] = value;
  renderYieldResult();
}

function yieldAddRow() {
  const rows = yieldRows();
  if (rows.length >= annualize.MAX_ROWS) return;
  rows.push({ date: '', nav: '' });
  renderYieldRows();
  renderYieldResult();
}

function yieldRemoveRow(i) {
  const rows = yieldRows();
  if (rows.length <= 2 || i < 0 || i >= rows.length) return;
  rows.splice(i, 1);
  renderYieldRows();
  renderYieldResult();
}

function yieldClear() {
  if (!yieldDraft) return;
  yieldDraft.rows = annualize.normalizeRows([], annualize.MAX_ROWS);
  renderYieldRows();
  renderYieldResult();
}

function yieldRowHtml(row, i, canRemove) {
  const dateLabel = i18n.t('日期');
  const navLabel = i18n.t('净值');
  const removeLabel = i18n.t('删除这个时点');
  return `<div class="yield-row">
    <input type="date" data-row="${i}" value="${text.esc(row.date)}" onchange="yieldUpdate(${i}, 'date', this.value)" aria-label="${dateLabel}">
    <input type="text" inputmode="decimal" autocomplete="off" value="${text.esc(row.nav)}" placeholder="1.0234" oninput="yieldUpdate(${i}, 'nav', this.value)" aria-label="${navLabel}">
    ${canRemove
      ? `<button type="button" class="row-btn" onclick="yieldRemoveRow(${i})" title="${removeLabel}" aria-label="${removeLabel}">✕</button>`
      : '<span></span>'}
  </div>`;
}

function renderYieldRows() {
  const host = document.getElementById('yield-rows');
  if (!host) return;
  yieldDisposePickers();
  const rows = yieldRows();
  const canRemove = rows.length > 2;
  host.innerHTML = [
    `<div class="yield-row"><span class="meta-label muted">${i18n.t('日期')}</span><span class="meta-label muted">${i18n.t('净值')}</span><span></span></div>`,
    ...rows.map((row, i) => yieldRowHtml(row, i, canRemove)),
  ].join('');
  const add = document.getElementById('yield-add');
  if (add) add.disabled = rows.length >= annualize.MAX_ROWS;
  yieldAttachPickers();
}

function yieldAttachPickers() {
  const host = document.getElementById('yield-rows');
  if (!host || typeof flatpickr === 'undefined') return;
  host.querySelectorAll('input[type=date]').forEach(el => {
    if (el._flatpickr) return;
    flatpickr(el, {
      locale: i18n.flatpickrLocale(flatpickr.l10ns, state.lang),
      dateFormat: 'Y-m-d',
      disableMobile: true,
      animate: true,
      weekNumbers: false,
      onChange: function (selectedDates, dateStr) {
        el.value = dateStr;
        yieldUpdate(Number(el.dataset.row), 'date', dateStr);
      },
    });
  });
}

function yieldSave() {
  if (!yieldDraft) return;
  if (!annualize.summarize(yieldDraft.rows).total) {
    toast(i18n.t('至少填两个时点'), 'error');
    return;
  }
  const rec = {
    id: yieldDraft.id,
    name: String(yieldDraft.name || '').trim(),
    rows: annualize.normalizeRows(yieldDraft.rows),
    updatedAt: new Date().toISOString(),
  };
  const items = yieldItems();
  const i = items.findIndex(it => it.id === rec.id);
  if (i >= 0) items[i] = rec; else items.push(rec);
  state.yieldCalc.items = annualize.normalizeItems(items);
  saveState();
  yieldDraft = null;
  yieldView = 'list';
  renderYieldModal();
  toast(i18n.t('已保存'), 'success');
}

function yieldDelete() {
  const rec = yieldSavedRecord();
  if (!rec) return;
  showConfirm(i18n.t('删掉这条换算？'), () => {
    state.yieldCalc.items = annualize.normalizeItems(yieldItems().filter(it => it.id !== rec.id));
    saveState();
    yieldDraft = null;
    yieldView = 'list';
    renderYieldModal();
    toast(i18n.t('记录已删除'), 'success');
  });
}

function yieldPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = Math.abs(v) < 0.005 ? 0 : v;
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function renderYieldResult() {
  const host = document.getElementById('yield-result');
  if (!host) return;
  const r = annualize.summarize(yieldRows());
  const out = [];
  if (r.invalid.length) {
    out.push(`<p class="t-micro" style="color:var(--down);margin:0 0 8px;">${i18n.t('{n} 行日期或净值无效', { n: r.invalid.length })}</p>`);
  }
  if (!r.total) {
    out.push(`<p class="t-micro muted" style="margin:0;">${i18n.t('至少填两个时点')}</p>`);
    host.innerHTML = out.join('');
    return;
  }
  const t = r.total;
  out.push(
    `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;">`,
    `<div><p class="meta-label muted" style="margin:0 0 4px;">${i18n.t('复利年化')}</p>`,
    `<p class="font-masthead tabular hero-figure" style="margin:0;color:${compareColor(t.compoundPct || 0, true)};">${yieldPct(t.compoundPct)}</p></div>`,
    `<p class="t-micro muted" style="margin:0;text-align:right;">`,
    `${i18n.t('{p1} 天 · 累计 {p2}', { p1: t.days, p2: yieldPct((t.growth - 1) * 100) })}<br>`,
    `${i18n.t('单利年化 {p1}', { p1: yieldPct(t.simplePct) })}</p>`,
    `</div>`
  );
  if (r.short) {
    out.push(`<p class="t-micro" style="color:var(--down);margin:8px 0 0;">${i18n.t('区间不足 {p1} 天，年化会被放大，仅供参考', { p1: annualize.SHORT_DAYS })}</p>`);
  }
  if (r.segments.length > 1) {
    out.push(
      `<div class="yield-seg list-head" style="margin-top:16px;"><div>${i18n.t('区间')}</div><div class="num">${i18n.t('天数')}</div><div class="num">${i18n.t('涨幅')}</div><div class="num">${i18n.t('年化')}</div></div>`,
      ...r.segments.map(s => `<div class="yield-seg">
        <div class="t-body tabular">${s.from}<span class="yield-arrow"> → </span>${s.to}</div>
        <div class="t-body num">${s.days}</div>
        <div class="t-body num">${yieldPct((s.growth - 1) * 100)}</div>
        <div class="t-body num" style="color:${compareColor(s.compoundPct || 0, true)};">${yieldPct(s.compoundPct)}</div>
      </div>`)
    );
  }
  host.innerHTML = out.join('');
}

document.addEventListener('DOMContentLoaded', () => {
  yieldView = 'list';
  renderYieldModal();
});
