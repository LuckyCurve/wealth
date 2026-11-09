// ========== 年化换算（独立工具：不挂资产、不发请求、输入随存档落盘）==========
// 产品页只给时点与净值、不给年化；这里反推。计算全在 logic.js annualize（纯函数），
// 本文件只管「输入 → 存档 → 渲染」。不读 state.assets，也不进 syncDerivedReads：
// 记一笔消费没必要重建用户正在填的输入框。

function yieldRows() {
  if (!state.yieldCalc || typeof state.yieldCalc !== 'object') state.yieldCalc = {};
  state.yieldCalc.rows = annualize.normalizeRows(state.yieldCalc.rows, annualize.MAX_ROWS);
  return state.yieldCalc.rows;
}

// 逐字落盘会把整份存档（含消费明细）每敲一下序列化一次；短延迟吞掉一次连续输入。
let yieldSaveTimer = 0;
function yieldSaveSoon() {
  clearTimeout(yieldSaveTimer);
  yieldSaveTimer = setTimeout(saveState, 400);
}

function yieldUpdate(i, field, value) {
  const rows = yieldRows();
  if (!rows[i]) return;
  rows[i][field] = value;
  yieldSaveSoon();
  renderYieldResult();
}

function yieldAddRow() {
  const rows = yieldRows();
  if (rows.length >= annualize.MAX_ROWS) return;
  rows.push({ date: '', nav: '' });
  yieldSaveSoon();
  renderYieldInputs();
  renderYieldResult();
}

function yieldRemoveRow(i) {
  const rows = yieldRows();
  if (rows.length <= 2 || i < 0 || i >= rows.length) return;
  rows.splice(i, 1);
  yieldSaveSoon();
  renderYieldInputs();
  renderYieldResult();
}

function yieldClear() {
  state.yieldCalc = { rows: [] };
  yieldRows();
  yieldSaveSoon();
  renderYieldTab();
}

// 输入区只在增删行/清空/换语言时重建：逐字输入只重画结果区，焦点与光标留在原处。
function renderYieldInputs() {
  const host = document.getElementById('yield-rows');
  if (!host) return;
  const rows = yieldRows();
  const canRemove = rows.length > 2;
  const dateLabel = i18n.t('日期');
  const navLabel = i18n.t('净值');
  const removeLabel = i18n.t('删除这个时点');
  host.innerHTML = [
    `<div class="yield-row"><span class="meta-label muted">${dateLabel}</span><span class="meta-label muted">${navLabel}</span><span></span></div>`,
    ...rows.map((row, i) => `<div class="yield-row">
      <input type="date" value="${text.esc(row.date)}" onchange="yieldUpdate(${i}, 'date', this.value)" aria-label="${dateLabel}">
      <input type="text" inputmode="decimal" autocomplete="off" value="${text.esc(row.nav)}" placeholder="1.0234" oninput="yieldUpdate(${i}, 'nav', this.value)" aria-label="${navLabel}">
      ${canRemove
        ? `<button type="button" class="row-btn" onclick="yieldRemoveRow(${i})" title="${removeLabel}" aria-label="${removeLabel}">✕</button>`
        : '<span></span>'}
    </div>`),
  ].join('');
  const add = document.getElementById('yield-add');
  if (add) add.disabled = rows.length >= annualize.MAX_ROWS;
}

function yieldPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = Math.abs(v) < 0.005 ? 0 : v; // -0.001 四舍五入成「-0.00%」很难看
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
  // 两个点以上才给逐段：两个点时它就是上面那行主读数，再来一张表只是重复。
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

function renderYieldTab() {
  if (!document.getElementById('yield-rows')) return;
  renderYieldInputs();
  renderYieldResult();
}

document.addEventListener('DOMContentLoaded', renderYieldTab);
