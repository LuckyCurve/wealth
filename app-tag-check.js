/*
 * app-tag-check.js — 数据校验（缺标签补齐）：两侧共用的一套弹窗与校验条。
 * --------------------------------------------------------------------------
 * 同一时刻只服务一侧（资产/消费），按侧别取集合 / 色板 / 行内摘要，所以它不属于消费页——
 * 资产侧也有自己的一条校验条，都调这里。写标签一律走 logic.js expense.setTag / backfillTag，
 * 本文件不给 tags 直接赋值（口径与「只填空缺、不覆盖已归类」的那条判据都在纯逻辑层）。
 *
 * 加载顺序：紧跟 app-expenses.js（两侧只在运行时互相调用）。
 */
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
    <div class="tagcheck-group-head mb-3">
      <div class="row-start">
        <h4 class="card-title-sm">${text.esc(cat.name)}</h4>
        ${head}
      </div>
      ${left.length ? '<span class="t-micro muted">' + i18n.t('点标签即生效') + '</span>' : ''}
    </div>
    <div class="tagcheck-batch mb-1">
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

