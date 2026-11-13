/*
 * app-stress.js — 压测：情景草稿、条与页头印徽的同步、压测弹窗。
 * --------------------------------------------------------------------------
 * 压测是「全局视图叠加」：只改读数，账本 / 快照 / 导出一律不动（决定见 DECISIONS.md）。
 * 口径全在 logic.js stress 域（stressActive / effectiveAssets / stressBarText …），
 * 这里只做三件事：把当前情景写成草稿、把草稿画成条与印徽、把草稿保存/取消。
 *
 * 为什么从 app-charts.js 拆出来：它与「画图」没有关系（条是 DOM，不是 ECharts），
 * 只是原先顺手放在图表文件里；而它有一套自己的弹窗、草稿态与恢复入口。
 *
 * 加载顺序：紧跟 app-charts.js（两边只在运行时互相调用）。
 */
// ========== 压测（情景编辑 + 条/印徽同步）==========
// 决策见 DECISIONS.md，口径在 logic.js stress 域；条/印徽/报头小字共用同一个「生效」判据，弹窗只改草稿。

function renderStressChrome() {
  const active = stress.stressActive(state.stress);
  const bar = document.getElementById('stress-bar');
  const text = document.getElementById('stress-bar-text');
  const badge = document.getElementById('stress-badge');
  const badgePct = document.getElementById('stress-badge-pct');
  if (bar && text) {
    // 三态（无可用维度 / 未启用 / 生效）与那句「未归类」尾巴的口径都在 logic.js.stress.stressBarText
    // （可单测）；这里只决定「显示与否」——没有可压测维度时也显示条，否则用户找不到入口。
    bar.style.display = stress.stressDimensions(state.categories).length > 0 || active ? '' : 'none';
    text.textContent = stress.stressBarText(state.stress, state.categories, ledgerAssets());
  }
  if (badge && badgePct) {
    badge.style.display = active ? '' : 'none';
    if (active) badgePct.textContent = ' -' + stress.weightedDrop(ledgerAssets(), state.stress, state.categories).toFixed(1) + '%';
  }
  // 只在「当前没开压测」且旧情景仍有效（分类/标签没被删）时给入口。
  const restore = document.getElementById('stress-restore');
  if (restore) restore.style.display = !active && stress.pruneStress(state.stressLast, state.categories) ? '' : 'none';
}

// 草稿：{ catId, keeps: [{ tag, keep }] }。打开时从 state 拷一份，改完保存才写回（取消不落库）。
let _stressDraft = null;

function openStressModal() {
  const dims = stress.stressDimensions(state.categories);
  if (dims.length === 0) {
    toast(i18n.t('先在「分类管理」里建一个分类'), 'error');
    return;
  }
  const cur = stress.pruneStress(state.stress, state.categories);
  const catId = cur && dims.some(c => c.id === cur.catId) ? cur.catId : dims[0].id;
  _stressDraft = { catId, keeps: cur && cur.catId === catId ? cur.keeps.map(d => ({ tag: d.tag, keep: d.keep })) : [] };
  fillStressDimensionSelect();
  renderStressKeeps();
  openModal('stress-modal');
}

function fillStressDimensionSelect() {
  const sel = document.getElementById('stress-dimension');
  if (!sel) return;
  const dims = stress.stressDimensions(state.categories);
  setSelectOptions(sel, dims.map(c => `<option value="${text.esc(c.id)}">${text.esc(c.name)}</option>`).join(''));
  if (_stressDraft && dims.some(c => c.id === _stressDraft.catId)) sel.value = _stressDraft.catId;
}

// 换维度 = 换一套标签：草稿里旧的比例条目一律作废（不同维度的标签不同名，留着只会误命中）
function onStressDimensionChange() {
  if (!_stressDraft) return;
  _stressDraft = { catId: document.getElementById('stress-dimension').value, keeps: [] };
  renderStressKeeps();
}

// 逐标签一行：标签名 + 当前折算金额 + 「还剩多少」滑块（拉满 = 没亏）。
// 存剩余不存跌幅（用户心智是「还剩多少」）；行数据由 logic.js 出，复用 .scale-input/.scale-reading。
function renderStressKeeps() {
  const box = document.getElementById('stress-keeps');
  if (!box || !_stressDraft) return;
  const cat = state.categories.find(c => c.id === _stressDraft.catId);
  if (!cat) { box.innerHTML = ''; return; }
  box.innerHTML = stress.stressKeepRows(ledgerAssets(), _stressDraft, state.categories).map(r => {
    const id = 'stress-keep-' + text.jsAttr(cat.id) + '-' + text.jsAttr(r.tag);
    return `<div class="drop-row">
      <span class="drop-head">
        ${tagPillHtml(cat, r.tag, catColor)}
        <span class="drop-amount">${money.formatCNY(r.amount)}</span>
      </span>
      <span class="drop-scale">
        <input type="range" id="${id}" class="scale-input" min="0" max="100" step="1" value="${r.keep}" style="--fill:${r.keep}%">
        <span class="scale-reading" id="${id}-readout">${r.keep}%</span>
      </span>
    </div>`;
  }).join('');
  // 滑块的 oninput 与可访问名都要用到标签名；标签是账本内容（不翻译），
  // 所以名字在渲染时按标签拼 —— 不能挂 data-i18n-aria-label（那要求键是静态中文原文）
  box.querySelectorAll('input[type="range"]').forEach(el => {
    const tag = el.id.slice(('stress-keep-' + cat.id + '-').length);
    el.oninput = () => onStressKeepInput(tag, el);
    el.setAttribute('aria-label', i18n.t('{p1} 的剩余比例（百分比）', { p1: tag }));
  });
  // 未归类口径说明：这里也必须写一句（用户调比例时会先问「没标签的那些算多少」）
  const un = stress.unclassifiedCNY(ledgerAssets(), { catId: cat.id, keeps: [{ tag: cat.tags[0], keep: 99 }] }, state.categories);
  document.getElementById('stress-unclassified').textContent = un.count > 0
    ? i18n.t('该维度下未归类的资产（{p1}，{p2} 项）按未打折计入。', { p1: money.formatCNY(un.cny), p2: un.count })
    : '';
}

function onStressKeepInput(tag, el) {
  if (!_stressDraft) return;
  setScaleValue(el, el.id + '-readout');
  const keep = Math.min(100, Math.max(0, Math.round(Number(el.value) || 0)));
  const at = _stressDraft.keeps.findIndex(d => d.tag === tag);
  if (at >= 0) _stressDraft.keeps[at].keep = keep;
  else _stressDraft.keeps.push({ tag, keep });
  const readout = document.getElementById(el.id + '-readout');
  if (readout) readout.textContent = keep + '%';
}

function saveStress() {
  if (!_stressDraft) { closeModal('stress-modal'); return; }
  // 归一 + 剪枝走 logic.js（与存档加载/导入共用同一口径）；全是「剩 100%」→ null 即「未启用
  const next = stress.pruneStress(_stressDraft, state.categories);
  const before = JSON.stringify(state.stress);
  state.stress = next;
  closeModal('stress-modal');
  if (JSON.stringify(next) === before) return;   // 没变就不重绘（空点击同理）
  saveState();
  renderAll();
  toast(next ? i18n.t('压测已启用') : i18n.t('压测已清除'), next ? 'info' : 'success');
}

function clearStress() {
  _stressDraft = null;
  const cur = stress.pruneStress(state.stress, state.categories);
  if (cur) state.stressLast = cur;
  state.stress = null;
  saveState();
  closeModal('stress-modal');
  renderAll();
  toast(i18n.t('压测已清除 · 可回到上一次'), 'success');
}

function restoreStress() {
  const last = stress.pruneStress(state.stressLast, state.categories);
  if (!last) return;
  state.stress = last;
  saveState();
  renderAll();
  toast(i18n.t('压测已恢复'), 'info');
}
