// ========== RENDER ==========
// 全量重绘：四个列表各刷一遍，收尾只重算一次派生读数。
// 不括起来的话两个列表渲染器各收尾一次，同一张图会被画两遍（setOption ×2）。
function renderAll() {
  _renderBatch++;
  try {
    renderAssets();
    renderCategories();
    renderHistoryTab();
    renderExpenses();
    renderCategoryCards('expense');
  } finally {
    _renderBatch--;
  }
  syncDerivedReads();
}

function renderAssets() {
  commitInlineEdit(false); // 重绘前收尾未提交的行内编辑（不触发递归重绘）
  const rows = document.getElementById('assets-rows');
  const empty = document.getElementById('assets-empty');
  const list = document.getElementById('assets-list');

  if (state.assets.length === 0) {
    empty.style.display = '';
    list.style.display = 'none';
  } else {
    empty.style.display = 'none';
    list.style.display = '';
    let sorted = [...state.assets];
    if (sortBy) {
      const getVal = sortBy === 'cny' ? (x) => money.toCNY(x.amount, x.currency) : null;
      sorted.sort((a, b) => compareBy(a, b, sortBy, sortDir, getVal));
    }
    updateSortIndicators('sort-', ['name', 'amount', 'currency', 'cny'], sortBy, sortDir);
    rows.innerHTML = sorted.map(a => {
      // 跳过 currency 分类: 货币列已单独显示, 避免重复 pill 挤占标签列
      const tagHtml = state.categories.filter(cat => cat.id !== 'currency').map(cat => {
        const tagVal = a.tags[cat.id];
        return tagVal ? tagPillHtml(cat, tagVal, catColor) : '';
      }).join(' ');
      const rateText = rateLabelText(a);
      const rateLabel = rateText || '<span class="muted hint-xs">' + i18n.t('未设置') + '</span>';
      const cashTag = rateText
        ? `<span class="ink-accent hint-xs">${i18n.t(' · 现金 ')}${income.cashRatioPct(a)}%</span>`
        : '';
      const cnyVal = money.toCNY(a.amount, a.currency);
      return `<div class="asset-row grid-wide" data-id="${text.esc(a.id)}">
        <div class="drag-handle" role="button" tabindex="0" aria-label="${i18n.t('调整排序，按上移或下移')}"
          title="${i18n.t('拖动排序（键盘：聚焦后按 ↑/↓）')}" draggable="true"
          ondragstart="onAssetDragStart(event)" ondragend="onAssetDragEnd(event)"
          onkeydown="if(event.key==='ArrowUp'){event.preventDefault();moveAsset('${text.jsAttr(a.id)}',-1);}else if(event.key==='ArrowDown'){event.preventDefault();moveAsset('${text.jsAttr(a.id)}',1);}">⠿</div>
        <div class="t-medium t-body">${text.esc(a.name)}</div>
        <div class="t-body tabular num amount-cell" data-id="${text.esc(a.id)}" role="button" tabindex="0" title="${i18n.t('点击快速更新金额')}" onclick="startInlineEdit('${text.jsAttr(a.id)}')" onkeydown="if(event.key==='Enter')startInlineEdit('${text.jsAttr(a.id)}')">
          <svg class="edit-pencil" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3l1 1-9 9-2.5.5.5-2.5L13 3z"/><path d="M10.7 5.3l1 1"/></svg>
          <span>${money.money2(a.amount)}</span>
        </div>
        <div class="t-body muted">${a.currency}</div>
        <div class="t-micro tabular num muted">${money.formatCNY(cnyVal)}</div>
        <div class="t-body tabular num">${rateLabel}${cashTag}</div>
        <div class="tag-row">${tagHtml}</div>
        <div class="row-actions">
          <button onclick="editAsset('${text.jsAttr(a.id)}')" class="row-btn edit">${i18n.t('编辑')}</button>
          <button onclick="deleteAsset('${text.jsAttr(a.id)}')" class="row-btn danger">${i18n.t('删除')}</button>
        </div>
      </div>`;
    }).join('');
  }

  // 数据校验条跟随资产/分类变化（全局口径，不随排序变化）
  renderTagCheckBar('asset');
  syncDerivedReads(); // 收尾：报头/压测指示器/可见图表一起重算
}

// ===== Masthead / net-worth hero =====
let _mastheadRaf = null;
let _mastheadPrev = 0;
// 当前应有的目标值：相等就不重启动画（列表重绘很频繁，否则计数动画会被拽回起点）
let _mastheadTarget = null;
// _reduceMotion 定义在台灯一节（文件顶部）：两处都读同一个信号，此处不得再声明一次

// 报头是唯一写入点，总资产也在这里现算：调用方传数就是「谁算的谁负责」的漏更新口子。
function renderMasthead() {
  const total = totalAssetsCNY();
  const wholeEl = document.getElementById('masthead-whole');
  const centsEl = document.getElementById('masthead-cents');
  const dateEl = document.getElementById('masthead-date');
  const ruleEl = document.getElementById('composition-rule');
  const legendEl = document.getElementById('composition-legend');
  const subEl = document.getElementById('masthead-sub');

  const paintAmount = (v) => {
    const [whole, cents] = v.toFixed(2).split('.');
    wholeEl.textContent = (parseInt(whole, 10) || 0).toLocaleString('zh-CN');
    centsEl.textContent = '.' + cents;
  };

  if (_reduceMotion) {
    paintAmount(total);
    _mastheadPrev = total;
    _mastheadTarget = total;
  } else if (total !== _mastheadTarget) {
    cancelAnimationFrame(_mastheadRaf);
    const from = _mastheadPrev;
    const dur = 650;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      paintAmount(from + (total - from) * eased);
      if (p < 1) _mastheadRaf = requestAnimationFrame(step);
      else _mastheadPrev = total;
    };
    _mastheadTarget = total;
    _mastheadRaf = requestAnimationFrame(step);
  }

  dateEl.textContent = date.getLocalDateStr().replace(/-/g, '/');

  const byCur = { CNY: 0, HKD: 0, USD: 0 };
  assetsInView().forEach(a => { byCur[a.currency] = (byCur[a.currency] || 0) + money.toCNY(a.amount, a.currency); });
  const segs = [
    { key: 'CNY', cls: 'seg-cny' },
    { key: 'HKD', cls: 'seg-hkd' },
    { key: 'USD', cls: 'seg-usd' },
  ];
  const parts = segs.map(s => ({ ...s, val: byCur[s.key] })).filter(s => s.val > 0);
  ruleEl.innerHTML = parts.map(p =>
    `<span class="${p.cls}" style="flex-grow:${Math.max(p.val, 1)}" title="${p.key}"></span>`
  ).join('') || '<span class="seg-other" style="flex-grow:1"></span>';
  legendEl.innerHTML = segs.map(s => {
    const v = byCur[s.key];
    return `<span><span class="dot ${s.cls}"></span>${s.key} <span class="tabular text-value">${money.pctStr(v, total)}%</span></span>`;
  }).join('');

  // 目标净资产进度（独立面板与货币构成条区分；总资产为 0 时不显示避免误报达成）
  const targetEl = document.getElementById('net-worth-target');
  const target = state.netWorthTarget || 0;
  if (target > 0 && total > 0) {
    targetEl.style.display = '';
    const pct = Math.min(100, total / target * 100);
    const achieved = total >= target;
    const fillColor = achieved ? 'var(--verdigris)' : (pct >= 90 ? 'var(--accent)' : 'var(--accent-soft)');
    const gap = achieved
      ? '<span class="mo-badge up">' + i18n.t('目标已达成') + '</span>'
      : `<span class="tabular ink-accent">${i18n.t('还差 ')}${money.formatCNY(target - total)}</span>`;
    targetEl.innerHTML = `
      <div class="target-panel">
        <div class="target-head t-micro mb-1.5 muted">
          <span>${i18n.t('目标净资产 · ')}<span class="tabular text-value">${pct.toFixed(0)}%</span></span>
          <span class="row-start">
            <span class="tabular text-value">${money.formatCNY(total)} / ${money.formatCNY(target)}</span>
            ${gap}
            <button onclick="openTargetModal()" class="btn-ghost btn-xs">${i18n.t('修改')}</button>
          </span>
        </div>
        <div class="target-progress"><div class="target-progress-fill" style="width:${pct}%;background:${fillColor};"></div></div>
      </div>`;
  } else if (target > 0) {
    targetEl.style.display = 'none';
  } else {
    targetEl.style.display = '';
    targetEl.innerHTML = `<div class="target-panel target-panel-empty">
      <span class="t-micro muted">${i18n.t('目标净资产')}</span>
      <button onclick="openTargetModal()" class="btn-ghost btn-xs">${i18n.t('设定目标')}</button>
    </div>`;
  }

  // sub line: 资产数 + 月收益/现金 双口径平齐展示（任一资产设置利率后出现）
  // 覆盖率差额叙述已完整收归覆盖标尺, 报头只保留收入金额与预期锚点, 不再重复叙述
  const count = state.assets.length;
  const hasRate = income.hasAnyRatedAsset(assetsInView()); // 纯函数在 logic.js（与收益 Tab 共用同一判定）
  const expectation = state.expenseExpectation || 0;
  let subText = `<span>${i18n.t('{p1} 项资产', { p1: count })}</span>`;
  if (hasRate) {
    // 两口径合计单一来源（logic.js income.sumAssetIncomes, 与收益摘要/覆盖标尺共用）
    const { monthly, cashMonthly } = income.sumAssetIncomes(assetsInView());
    if (expectation > 0) {
      subText += ` · <span class="muted">${i18n.t('预期月消费 ')}<span class="tabular t-medium text-value">${money.formatCNY(expectation)}</span></span>`;
    }
    subText += ` · <span>${i18n.t('预估月收益 ')}<span class="tabular t-medium ink-up">${money.formatCNY(monthly)}</span></span>`;
    subText += ` · <span>${i18n.t('现金收益 ')}<span class="tabular t-medium ink-accent">${money.formatCNY(cashMonthly)}</span></span>`;
  }
  if (stress.stressActive(state.stress)) {
    const origTotal = money.sumAmountCNY(ledgerAssets(), state.rates);
    const drop = stress.weightedDrop(ledgerAssets(), state.stress, state.categories);
    subText += ' · <span class="ink-accent">' +
      i18n.t('压测 {p1}', { p1: '-' + drop.toFixed(1) + '%' }) +
      i18n.t(' · 原值 ') + money.formatCNY(origTotal) + '</span>';
  }
  subEl.innerHTML = subText;
}

// ========== NET WORTH TARGET ==========
function openTargetModal() {
  document.getElementById('target-input').value = money.moneyStr(state.netWorthTarget);
  openModal('target-modal');
}
function saveTarget() {
  const v = money.parseMoneyInput(document.getElementById('target-input').value);
  if (!v || v <= 0) { toast(i18n.t('请输入有效的目标金额'), 'error'); return; }
  const hadTarget = (state.netWorthTarget || 0) > 0;
  state.netWorthTarget = v;
  saveState();
  closeModal('target-modal');
  renderAssets(); // 刷新 masthead 进度
  toast(hadTarget ? i18n.t('目标已更新') : i18n.t('目标已设置'), 'success');
}
function clearTarget() {
  showConfirm(i18n.t('确认清除目标净资产？'), () => {
    state.netWorthTarget = 0;
    saveState();
    closeModal('target-modal');
    renderAssets();
    toast(i18n.t('目标已清除'), 'success');
  });
}

function renderCategories() {
  renderCategoryCards('asset');
}

// ========== 平铺标签选择器（资产/消费表单 + 数据校验面板共用）==========
// 标签 chip 单一来源: 录入表单/校验面板的单选 picker 与读数区的多选 picker 共用同一视觉与选中态,
// 差异只在 attrs（各自的 data-* 与 onclick）与颜色函数（资产 catColor / 消费 expenseCatColor）
function tagChipHtml(catId, tag, pressed, attrs, colorFn) {
  const c = colorFn(catId, tag);
  return `<button type="button" class="tag-choice" aria-pressed="${pressed}" ${attrs}
    style="--chip-bg:${c.bg};--chip-fg:${c.fg};--chip-ring:${color.hexToRgba(c.fg, 0.28)};">${text.esc(tag)}</button>`;
}

function tagPickerHtml(cats, selectedFor, idPrefix, colorFn, opts) {
  const withLabel = !(opts && opts.hideLabel);
  return cats.map(cat => {
    const selected = selectedFor(cat) || '';
    const chips = cat.tags.map(t => tagChipHtml(
      cat.id, t, t === selected,
      `data-val="${text.esc(t)}" onclick="selectTagChoice(this)"`, colorFn)).join('');
    // id 与 data-target 由**调用方拼好的前缀 + cat.id** 组成，两者都可能来自存档（导入的 JSON）：
    // 不转义时 id 里一个双引号就截断属性并插进新标签（实测 data-eid 那条路径能执行脚本），
    // 而「前缀里的记录 id」正是最脏的那一段（记录 id 不经用户手，出问题时也最难查）。
    // 写入与查找两端都走同一个转义后的串，getElementById 才对得上。
    const hidId = text.esc(idPrefix + cat.id);
    return `<div>
      ${withLabel ? `<label class="field-label">${text.esc(cat.name)}</label>` : ''}
      <input type="hidden" id="${hidId}" value="${text.esc(selected)}">
      <div class="tag-picker" data-target="${hidId}">${chips}</div>
    </div>`;
  }).join('');
}

function selectTagChoice(btn) {
  const picker = btn.closest('.tag-picker');
  const input = picker && document.getElementById(picker.dataset.target);
  if (!input) return;
  if (input.value === btn.dataset.val) {
    input.value = '';
    picker.querySelectorAll('.tag-choice').forEach(b => b.setAttribute('aria-pressed', 'false'));
    return;
  }
  input.value = btn.dataset.val;
  picker.querySelectorAll('.tag-choice').forEach(b => b.setAttribute('aria-pressed', b === btn));
}

// 读取平铺 picker 的选中值（资产/消费两侧表单共用）：任一分类没选 → complete=false，
// 表单据此提示「请为每个分类选择标签」，不各自再写一遍收集循环。
function collectPickedTags(cats, idPrefix) {
  const tags = {};
  let complete = true;
  cats.forEach(cat => {
    const el = document.getElementById(idPrefix + cat.id);
    const val = el ? el.value : '';
    if (val) tags[cat.id] = val;
    else complete = false;
  });
  return { tags, complete };
}


// ========== ASSET CRUD ==========

// 行内金额快速编辑（免开弹窗）: 点击金额单元格 → input 替换 → Enter 提交 / Esc 取消 / 失焦提交。
// 编辑态为单例（_inlineEditId）; renderAssets 重绘前统一收尾, 避免 input 被销毁后未提交的改动丢失。
let _inlineEditId = null;

function startInlineEdit(id) {
  if (_inlineEditId === id) return; // 已在编辑该行: 点击 input 移动光标时忽略冒泡, 不触发提交
  commitInlineEdit(true); // 先收尾上一个编辑行
  const a = state.assets.find(x => x.id === id);
  // 选择器里的 id 也要转义：存档里的 id 可能带引号/尖括号（导入的 JSON），
  // 直接插进属性选择器会抛 SyntaxError 或匹配错行
  const cell = document.querySelector(`#assets-rows .asset-row[data-id="${CSS.escape(id)}"] .amount-cell`);
  if (!a || !cell) return;
  _inlineEditId = id;
  const row = cell.closest('.asset-row');
  if (row) row.classList.add('editing');
  cell.dataset.title = cell.title;
  cell.title = i18n.t('Enter 保存 · 小键盘 Enter/Tab 下一行 · Esc 取消');
  cell.innerHTML = `<input type="text" class="inline-edit-input" value="${money.moneyStr(a.amount)}" inputmode="decimal" autocomplete="off" oninput="formatMoneyInput(this)" onkeydown="onInlineEditKey(event,'${text.jsAttr(id)}')" onblur="commitInlineEdit()">`;
  const inp = cell.querySelector('input');
  if (inp) { inp.focus(); inp.select(); }
}

// 提交行内编辑。doRender=false 时仅更新 state 不重绘（renderAssets 开头调用, 重绘正在进行）;
// 值非法/不变时恢复单元格文本, 不写 storage。返回 true=可继续（成功提交或无需提交）, false=值非法中止。
function commitInlineEdit(doRender) {
  doRender = doRender !== false;
  if (!_inlineEditId) return true;
  const id = _inlineEditId;
  _inlineEditId = null; // 先清标记: Esc 取消或 input 被销毁时, 后续 onblur 不再生效
  const a = state.assets.find(x => x.id === id);
  const cell = document.querySelector(`#assets-rows .asset-row[data-id="${CSS.escape(id)}"] .amount-cell`);
  if (!a || !cell) return true;
  const row = cell.closest('.asset-row');
  if (row) row.classList.remove('editing');
  if (cell.dataset.title != null) { cell.title = cell.dataset.title; delete cell.dataset.title; }
  const inp = cell.querySelector('input');
  if (!inp) { cell.innerHTML = money.money2(a.amount); return true; } // input 已销毁（重绘前收尾）, 直接恢复
  const val = money.parseMoneyInput(inp.value);
  if (isNaN(val) || val < 0) {
    toast(i18n.t('金额无效，已恢复原值'), 'error');
    cell.innerHTML = money.money2(a.amount);
    return false;
  }
  if (val === a.amount) { cell.innerHTML = money.money2(a.amount); return true; }
  a.amount = val;
  saveState();
  if (doRender) {
    if (sortBy) {
      // 排序激活: 行位置需重排, 走完整重绘（blur 后立即点按钮的 click 可能丢失, 排序状态下少见）
      renderAssets();
    } else {
      // 用户主动提交（blur/Enter/Tab）: 不整表重绘, 只同步该格与全部派生读数
      // ——压测条/页头副行/可见图表都靠 syncDerivedReads 一处跟上，不再在这里挑几处补
      cell.innerHTML = money.money2(a.amount);
      syncDerivedReads();
    }
  }
  return true;
}

// 行内编辑键盘: 主键盘 Enter 仅保存（blur 触发保存）; 小键盘 Enter 与 Tab/Shift+Tab 同义, 保存并跳到下一/上一行;
// Esc 取消并恢复原值。键位判定下沉 logic.js 纯函数, 不在此内联区分主/副键盘分支。
function onInlineEditKey(e, id) {
  const action = ui.inlineEditKeyAction(e.key, e.code);
  if (action === 'commit') {
    e.preventDefault();
    e.stopPropagation(); // 阻止 keydown 冒泡到 cell 的 onkeydown（Enter 会 startInlineEdit, 且此时 _inlineEditId 已被 commit 清空、守卫失效, 会导致提交后立即重新进入编辑态）
    e.target.blur(); // 触发 onblur → commitInlineEdit
  } else if (action === 'cancel') {
    e.preventDefault();
    _inlineEditId = null; // 取消: 阻止 onblur 提交
    const a = state.assets.find(x => x.id === id);
    const cell = e.target.closest('.amount-cell');
    if (cell && a) {
      cell.innerHTML = money.money2(a.amount);
      const row = cell.closest('.asset-row');
      if (row) row.classList.remove('editing');
      if (cell.dataset.title != null) { cell.title = cell.dataset.title; delete cell.dataset.title; }
      cell.focus(); // 焦点还给单元格（tabindex=0）, Enter 可重新编辑 / Tab 继续
    }
  } else if (action === 'jump') {
    e.preventDefault();
    // 小键盘 Enter 的 key 同样是 'Enter'，不阻止冒泡会触发 cell 的 onkeydown → startInlineEdit(原行)，
    // 把刚跳到的下一行撤销、重进原行。Tab 一并阻止无副作用（document 层标签导航本就不处理输入框）
    e.stopPropagation();
    // 值非法时 commit 已恢复原值并返回 false: 立即重回编辑态, 不打断流式录入
    if (!commitInlineEdit(true)) { startInlineEdit(id); return; }
    const rows = document.querySelectorAll('#assets-rows .asset-row');
    let cur = null;
    for (const r of rows) { if (r.dataset.id === id) { cur = r; break; } }
    const next = cur && (e.shiftKey ? cur.previousElementSibling : cur.nextElementSibling);
    if (next && next.dataset.id) startInlineEdit(next.dataset.id);
  }
}

function openAssetModal(editId) {
  const modal = document.getElementById('asset-modal');
  const title = document.getElementById('asset-modal-title');
  const form = document.getElementById('asset-form');
  form.reset();
  document.getElementById('asset-edit-id').value = editId || '';

  if (editId) {
    title.textContent = i18n.t('编辑资产');
    const a = state.assets.find(x => x.id === editId);
    if (a) {
      document.getElementById('asset-name').value = a.name;
      document.getElementById('asset-amount').value = money.moneyStr(a.amount);
      document.getElementById('asset-currency').value = a.currency;
      document.getElementById('asset-rate-min').value = a.expectedRateMin ?? 0;
      document.getElementById('asset-rate-max').value = a.expectedRateMax ?? 0;
      document.getElementById('asset-cash-ratio').value = a.cashRatio ?? 100;
    }
  } else {
    title.textContent = i18n.t('登记资产');
  }

  const asset = editId ? state.assets.find(x => x.id === editId) : null;
  document.getElementById('asset-tags-section').innerHTML = tagPickerHtml(
    state.categories.filter(cat => cat.id !== 'currency'),
    cat => asset ? (asset.tags[cat.id] || '') : '',
    'asset-tag-', catColor);

  setScaleValue(document.getElementById('asset-cash-ratio'), 'asset-cash-ratio-readout');

  openModal('asset-modal');
}

function saveAsset(e) {
  e.preventDefault();
  const editId = document.getElementById('asset-edit-id').value;
  const name = document.getElementById('asset-name').value.trim();
  const amount = money.parseMoneyInput(document.getElementById('asset-amount').value);
  if (isNaN(amount) || amount < 0) { toast(i18n.t('请输入有效的金额'), 'error'); return; }
  const currency = document.getElementById('asset-currency').value;

  // 利率: 只有输入框真正为空才用另一值补齐; 0 是合法的利率下限, 不能当空值吞掉
  // （否则 0-5% 会被折叠成 5-5%，且「只填 min 留空 max」会先被校验拒绝）
  const minStr = document.getElementById('asset-rate-min').value.trim();
  const maxStr = document.getElementById('asset-rate-max').value.trim();
  const rateMin = minStr === '' ? NaN : parseFloat(minStr);
  const rateMax = maxStr === '' ? NaN : parseFloat(maxStr);
  let finalMin = isNaN(rateMin) ? rateMax : rateMin;
  let finalMax = isNaN(rateMax) ? rateMin : rateMax;
  if (isNaN(finalMin)) finalMin = 0;
  if (isNaN(finalMax)) finalMax = 0;

  if (finalMin > finalMax) {
    toast(i18n.t('最低利率不能高于最高利率'), 'error');
    return;
  }

  const cashRatioStr = document.getElementById('asset-cash-ratio').value.trim();
  let cashRatio = cashRatioStr === '' ? 100 : parseFloat(cashRatioStr);
  if (!isFinite(cashRatio)) cashRatio = 100;
  cashRatio = Math.min(100, Math.max(0, cashRatio));

  const tags = { currency };
  const picked = collectPickedTags(
    state.categories.filter(cat => cat.id !== 'currency'), 'asset-tag-');
  Object.assign(tags, picked.tags);

  if (!picked.complete) {
    toast(i18n.t('请为每个分类选择标签'), 'error');
    return;
  }

  if (editId) {
    const idx = state.assets.findIndex(a => a.id === editId);
    if (idx >= 0) {
      const updated = { ...state.assets[idx], name, amount, currency, tags, expectedRateMin: finalMin, expectedRateMax: finalMax, cashRatio };
      delete updated.expectedRate;
      state.assets[idx] = updated;
    }
  } else {
    state.assets.push({ id: genId(), name, amount, currency, tags, expectedRateMin: finalMin, expectedRateMax: finalMax, cashRatio });
  }

  saveState();
  renderAssets();
  closeModal('asset-modal');
  toast(editId ? i18n.t('资产已更新') : i18n.t('资产已登记'), 'success');
}

function editAsset(id) {
  openAssetModal(id);
}

function setCashRatioPreset(v) {
  const el = document.getElementById('asset-cash-ratio');
  el.value = String(v);
  setScaleValue(el, 'asset-cash-ratio-readout');
}

function onCashRatioInput() {
  setScaleValue(document.getElementById('asset-cash-ratio'), 'asset-cash-ratio-readout');
}

function deleteAsset(id) {
  showConfirm(i18n.t('确认删除该资产？'), () => {
    state.assets = state.assets.filter(a => a.id !== id);
    saveState();
    renderAssets();
    toast(i18n.t('已删除'), 'success');
  });
}


// 图表文字/线条随主题取色（ECharts canvas 不识别 CSS 变量, 需读取计算后的值）
// 注：color.CATEGORY_PALETTE（旭日图 / 堆叠柱调色板）已迁移至 logic.js，浏览器下由全局注入，逻辑与单测共用同一份。
const TOOLTIP_CSS = 'border-radius:6px;padding:10px 14px;box-shadow:0 6px 18px var(--shadow-lift);';
// ECharts canvas 不认 CSS 变量，字体族只能以字面量传给各图；集中一处，改字族只改这里。
const CHART_FONT = '"IBM Plex Mono", monospace';

// ECharts 按需加载：默认（消费）页不画图，首屏不必下载整包图表库。
// 只在第一次 init 时加载；容器不可见（0 宽/高）既不加载也不 init——
// 拿 0 去 init 才是把图做废的那一步（与 observeChartSize 同一约束）。
let echartsLoading = null;
function ensureEChartsReady(el) {
  if (!el || el.clientWidth === 0 || el.clientHeight === 0) return Promise.resolve(false);
  if (window.echarts) return Promise.resolve(true);
  if (!echartsLoading) {
    echartsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
      s.onload = resolve;
      s.onerror = () => { echartsLoading = null; reject(new Error('echarts-load-failed')); }; // 失败允许下次重试
      document.head.appendChild(s);
    });
  }
  return echartsLoading.then(() => true, () => {
    toast(i18n.t('图表组件加载失败'), 'error');
    return false;
  });
}
// ========== 图表宿主：五张图共用同一段生命周期 ==========
// 宿主守四条：按需加载 / 容器不可见不 init / init 后立刻登记尺寸 / 换数据前清强调态；监听器只在 init 注册一次。
function chartSlot(get, set) {
  return { get: get, set: set };
}

async function chartApply(spec) {
  let chart = spec.slot.get();
  if (!chart) {
    if (!(await ensureEChartsReady(spec.el))) return null;
    if (spec.slot.get()) return spec.slot.get(); // 并发调用已经建好并画过
    chart = echarts.init(spec.el);
    observeChartSize(chart);
    spec.slot.set(chart);
    if (spec.wire) spec.wire(chart);
  }
  chart.dispatchAction({ type: 'downplay' });
  // 图表动画也进节奏系统（真库不认 prefers-reduced-motion）；判据在 logic.js chart.motion，这里只喂 CSS token。
  // 不能写 chart.motion：本函数的局部 chart 是 ECharts 实例（实翻过：整页图表全灭）。
  const mo = motion.chartMotion(
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mo-mid')) || 0.25,
    _reduceMotion
  );
  chart.setOption(Object.assign({}, spec.option, mo), true);
  return chart;
}


function showChartOrEmpty(chartEl, emptyEl, show) {
  chartEl.style.display = show ? '' : 'none';
  emptyEl.style.display = show ? 'none' : '';
}

// 分布图右侧构成清单（两张旭日图共用）：数据与占比口径在 logic.js，这里只管 DOM。
// total 必须与 tooltip 是同一个变量；悬停清单行高亮对应扇区——两栏是同一张量表。
function renderSunburstLegend(elId, data, total, chartObj) {
  const el = document.getElementById(elId);
  if (!el) return;
  const selected = sunburstLegendSel[elId] || null;
  const rows = chartData.sunburstLegendRows(data, total, selected);
  // 选中态在当前数据里已不存在（换了分类维度/月份，或那个分类被删）→ 顺势清掉。
  // 只靠 chartData.sunburstLegendRows 回落是不够的：状态会一直卡着，等用户切回一个恰好含同名分类的
  // 维度时就会莫名其妙地「又是下钻态」（像见了鬼）。
  // 不在当前数据里就归零（一行写完：两个分支各写一次会让「选中态写入点」难以数清）
  const atTop = !selected || !data.some(n => n && n.name === selected);
  sunburstLegendSel[elId] = atTop ? null : selected;
  if (rows.length === 0) {
    el.innerHTML = '';
    return;
  }
  // 色块直接取数据节点自带的 itemStyle.color——那就是扇区的颜色（chartData.buildSunburstData 一处写入）。
  // **不能**按「分类在 data 里的下标」重算色板：下钻时 data 已被裁成单个分类，
  // 下标恒为 0，于是 HKD（绿）的色块会变成 CNY 的红色（真实浏览器实测）。
  const nodeOf = (r) => {
    if (atTop) return data[r.idx];
    const parent = data.find(n => n && n.name === r.path[0]);
    const kids = parent && Array.isArray(parent.children) ? parent.children : [];
    return kids[r.idx];
  };
  const swatchOf = (r) => {
    const n = nodeOf(r);
    return (n && n.itemStyle && n.itemStyle.color) || 'transparent';
  };
  el.innerHTML = rows.map((r) => {
    const flat = chartData.sunburstNodePath(data, atTop ? r.idx : data.findIndex(n => n && n.name === r.path[0]), atTop ? null : r.idx);
    // 只有顶层行会带你去别处（下钻），故只有它给可点语义。
    // 明细行随鼠标高亮扇区是「看着这里」而不是导航，不必占 Tab 序——
    // 可点就要键盘可达，不可点就不该抢焦点。
    const hit = atTop
      ? ` class="chart-legend-row row-hit" tabindex="0" role="button"` +
        ` onkeydown="if(ui.activateKeyAction(event.key)){event.preventDefault();drillSunburst('${elId}','${text.jsAttr(r.name)}');}"`
      : ' class="chart-legend-row"';
    return `<div${hit} data-idx="${r.idx}" data-flat="${flat === null ? '' : flat}" data-top="${atTop ? '1' : ''}"` +
      ` data-name="${text.esc(r.name)}" title="${text.esc(r.name)}">` +
      `<span class="chart-legend-swatch" style="background:${swatchOf(r)}"></span>` +
      `<span class="chart-legend-name">${text.esc(r.name)}</span>` +
      `<span class="chart-legend-amt tabular">${money.formatCNY(r.value)}</span>` +
      `<span class="chart-legend-pct tabular">${r.pct}%</span></div>`;
  }).join('');
  // 顶部标题：选中后换成一个返回条，否则用户不知道自己在哪一层、也回不去
  const head = document.getElementById(elId + '-head');
  if (head) {
    head.innerHTML = atTop
      ? '<span class="meta-label muted">' + i18n.t('构成') + '</span>'
      : `<button type="button" class="legend-back" data-back="1">${i18n.t('‹ 全部分类')}</button>` +
        `<span class="legend-scope">${text.esc(selected)}</span>`;
  }
  // 悬停联动用事件委派挂在容器上（行数随分类变，逐行挂监听会随重绘越积越多）
  const at = (e) => {
    const row = e.target.closest ? e.target.closest('.chart-legend-row') : null;
    return row ? { flat: row.dataset.flat === '' ? null : +row.dataset.flat } : null;
  };
  el.onmouseover = (e) => { const a = at(e); if (a && a.flat !== null && chartObj) chartObj.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: a.flat }); };
  el.onmouseout = (e) => { const a = at(e); if (a && a.flat !== null && chartObj) chartObj.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex: a.flat }); };
  // 点击行：顶层行 → 下钻到该分类；明细行 → 只高亮（不再往下，sunburst 只有两层）
  el.onclick = (e) => {
    const row = e.target.closest ? e.target.closest('.chart-legend-row') : null;
    if (!row) return;
    drillSunburst(elId, row.dataset.top ? row.dataset.name : (sunburstLegendSel[elId] || null));
  };
  if (head) head.onclick = (e) => { if (e.target.dataset && e.target.dataset.back) drillSunburst(elId, null); };
}

// 旭日图「选中分类」状态：按清单容器各存一份，存名字不存下标（换维度后下标会指向别的分类）。
// 这是图的唯一视图状态——不让 ECharts 用 nodeClick 自己维护 viewRoot（两套状态 = 「返回了但图没回来」）。
let sunburstLegendSel = {};

// 选中某分类（null = 回到全部分类）。唯一入口：图上扇区点击与清单行点击都走这里。
// 选中既改清单内容、也改图的数据——两者都由渲染函数从选中态派生，不存在「只改一边」。
// 重绘回调按清单容器登记（三个图各一份）：用一个全局回调会被后注册的那张图覆盖掉，
// 点 A 图的清单却刷了 C 图。回调是**整个渲染函数**（清单 + setOption），否则图不会跟着下钻。
const sunburstRerender = {};

function drillSunburst(elId, catName) {
  const next = catName || null;
  if ((sunburstLegendSel[elId] || null) === next) return;
  sunburstLegendSel[elId] = next;
  const fn = sunburstRerender[elId];
  if (typeof fn === 'function') fn();
}

// 扇区点击 → 选中该分类（点内环分类即返回全部）；三张旭日图共用这一处接线，只在 init 时注册一次。
// 判层级用 treePathInfo，不拿 dataIndex 反推（它是扁平树下标，会差一）。
function wireSunburstDrill(chartObj, elId) {
  if (!chartObj) return;
  chartObj.on('click', (p) => {
    const path = p.treePathInfo || [];
    const node = path[1];
    if (path.length !== 2 || !node) return;
    drillSunburst(elId, node.name === sunburstLegendSel[elId] ? null : node.name);
  });
}

// 分布图总数（资产/消费旭日图共用）：旭日图只给各部分占比，这里补一个「当前筛选」的合计。
// 与 showChartOrEmpty 同判据——空态时一并收起，否则会留下一个孤零零的数字压在空态提示上。
function renderChartTotal(el, value) {
  if (!el) return;
  el.textContent = money.formatCNY(value);
  el.style.display = '';
}

function hideChartTotal(el) {
  if (el) el.style.display = 'none';
}

function chartTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => (cs.getPropertyValue(n) || '').trim();
  return {
    fg: v('--fg') || '#211b10',
    muted: v('--muted') || '#786a46',
    line: v('--rule') || '#d8cbab',
    split: v('--bg-2') || '#efe8d6',
    card: v('--card') || '#fffcf3',
    accent: v('--accent') || '#b4841a',
    down: v('--down') || '#982f3a',
  };
}

function chartTooltipBase(th) {
  return {
    trigger: 'item',
    backgroundColor: th.card,
    borderColor: th.line,
    borderWidth: 1,
    textStyle: { color: th.fg, fontFamily: CHART_FONT, fontSize: 12 },
    extraCssText: TOOLTIP_CSS,
  };
}

// 堆叠柱底座（历史净值/消费趋势共用）：mode='percent' 时 y 轴固定 0~100。
// legendData 控图例顺序，legendSelected 回灌隐藏态——切模式/主题/汇率刷新不丢用户的图例选择。
function barChartBase(th, dates, mode, legendData, legendSelected) {
  return {
    backgroundColor: 'transparent',
    legend: Object.assign(
      { show: true, type: 'scroll', bottom: 0, textStyle: { color: th.fg } },
      legendData ? { data: legendData } : {},
      legendSelected && Object.keys(legendSelected).length ? { selected: legendSelected } : {}),
    grid: { left: '3%', right: '4%', bottom: '22%', top: '10%', containLabel: true },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: th.line } }, axisLabel: { color: th.muted, fontFamily: CHART_FONT, fontSize: 11 } },
    yAxis: mode === 'percent'
      ? { type: 'value', max: 100, axisLabel: { color: th.muted, fontFamily: CHART_FONT, fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: th.split } } }
      : { type: 'value', axisLabel: { color: th.muted, fontFamily: CHART_FONT, fontSize: 11, formatter: v => v.toLocaleString('zh-CN', {minimumFractionDigits:0, maximumFractionDigits:0}) }, splitLine: { lineStyle: { color: th.split } } },
  };
}

// 堆叠柱系列样式（历史净值 / 消费趋势共用，原先两处逐字重复）：
// 颜色按标签在分类中的原始下标取色，保持稳定不随排序变化；focus/blur 也同一套。
function barSeriesStyle(cat, tag) {
  const pal = color.CATEGORY_PALETTE[cat.tags.indexOf(tag) % color.CATEGORY_PALETTE.length];
  return {
    name: tag, type: 'bar', stack: 'total',
    itemStyle: { color: pal.base },
    emphasis: { focus: 'self' },
    blur: { itemStyle: { opacity: 0.2 } },
  };
}

// 堆叠柱点击下钻接线单一来源（历史净值/消费趋势共用，原先两处内联 handler 各自漂移）：
// metaGetter() 返回当前渲染上下文 { catId, months, tags }（图表未就绪/早退时返回 null）；
// 点击色块按 seriesIndex→标签、dataIndex→月份 反查后回调 openSegment(month, catId, tag)。
// TOTAL_SERIES_NAME 为消费趋势透明合计承载系列（其 markLine 点击同源），统一忽略；历史图无此系列，无害
const TOTAL_SERIES_NAME = '__total__';
function wireStackedBarDrill(chartObj, metaGetter, openSegment) {
  chartObj.on('click', p => {
    if (p.seriesName === TOTAL_SERIES_NAME) return;
    const meta = metaGetter();
    if (!meta) return;
    const tag = meta.tags[p.seriesIndex];
    const month = meta.months[p.dataIndex];
    if (tag == null || !month) return;
    openSegment(month, meta.catId, tag);
  });
}

// 对比弹窗顶部「总变动」hero + 上下文行（资产快照对比 / 消费月对比共用，原先两段逐字重复）。
// goodWhenUp=true 时上涨绿（资产净值），false 时上涨红（消费支出），与 compareColor/momCompareHtml 同语义
function renderCompareHero(heroEl, ctxEl, diff, baseTotal, compTotal, baseLabel, compLabel, goodWhenUp) {
  const up = diff >= 0;
  const sign = up ? '+' : '-';
  if (diff === 0) {
    heroEl.style.color = 'var(--muted)';
    heroEl.innerHTML = `±${money.formatCNY(0)} (0.00%)`;
  } else {
    const pct = baseTotal > 0
      ? `<span class="muted" style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:400;"> (${sign}${(Math.abs(diff) / baseTotal * 100).toFixed(2)}%)</span>`
      : '';
    heroEl.style.color = compareColor(diff, goodWhenUp);
    heroEl.innerHTML = `${up ? '▲' : '▼'} ${sign}${money.formatCNY(Math.abs(diff))}${pct}`;
  }
  ctxEl.textContent = `${baseLabel} ${money.formatCNY(baseTotal)} → ${compLabel} ${money.formatCNY(compTotal)}`;
}

// 对比表「变动 %」单元格（资产快照对比 / 消费月对比共用）：无基数 —、零变动 0.00%、否则带符号着色
function cmpPctCell(d, p, colorFn) {
  const s = d >= 0 ? '+' : '';
  return p == null ? '<span class="muted">—</span>'
    : d === 0 ? '<span class="muted">0.00%</span>'
    : `<span class="tabular" style="color:${colorFn(d)};">${s}${p.toFixed(1)}%</span>`;
}

// 对比差额条：零线在正中间，涨往右、跌往左，一眼看出方向。半宽口径走 logic.js 单一来源；
// 精确 ±¥ 仍由骨架写在条上方，条只负责相对关系，不替代读数。
function cmpBar(d, maxAbs, colorFn) {
  const m = ui.cmpDeltaBarModel(d, maxAbs);
  if (m.side === 'none') return '';
  return `<div class="cmp-bar-track"><div class="cmp-bar cmp-bar-${m.side}" style="width:${m.width}%;background:${colorFn(d)};"></div><span class="cmp-bar-axis"></span></div>`;
}

// 趋势列表/历史净值行的「带符号小条」：同一零轴语言缩到一行里，精确金额仍在旁边文字中。
// 与 cmpBar 共用 cmpDeltaBarModel，不另算符号与宽度。
function cmpMiniBar(d, maxAbs, colorFn) {
  const m = ui.cmpDeltaBarModel(d, maxAbs);
  if (m.side === 'none') return '';
  return `<span class="cmp-mini-track"><span class="cmp-mini cmp-mini-${m.side}" style="width:${m.width}%;background:${colorFn(d)};"></span><span class="cmp-bar-axis"></span></span>`;
}

// 弹窗打开的统一入口（与 closeModal 成对）
// ========== 弹窗焦点管理 ==========
// ARIA 只兑现一半：焦点进弹窗、Tab 不出去、关闭还给触发元素。判据在 logic.js ui.trapFocus。

// 弹窗内可聚焦元素：打开时取第一个、Tab 陷阱取全集，两处共用一份（不许各写一遍选择器）。
// 为什么过滤 offsetParent：被 CSS 隐藏/折叠的控件仍在 DOM 里，focus() 上去等于把焦点丢出弹窗。
function modalFocusables(modal) {
  if (!modal) return [];
  const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...modal.querySelectorAll(sel)].filter(el => el.offsetParent !== null || el === document.activeElement);
}

// 记住「谁打开的弹窗」，关闭时把焦点还回去。用栈而非单值：确认框会叠在别的弹窗之上
// （如删除资产 → 确认框），单值会被后者覆盖，关掉确认框后焦点就回不到原处了。
let __modalReturnFocus = [];

// 「最上层弹窗」的唯一判据。15 个遮罩的 z-index 全一样，谁在上面本来只由 DOM 次序决定——
// 而确认框在 DOM 里排在好几个弹窗**之前**，于是它叠到它们上面时会被整个盖住（点击穿透到下层、
// ESC 关掉的是下层）。故打开时把该弹窗挪到 body 末尾，DOM 次序与打开次序一致；
// ESC / Tab 陷阱 / 命中测试都读这一处，不再各自 sort。
function openModalStack() {
  return [...document.querySelectorAll('.modal-overlay')].filter(m => m.style.display !== 'none');
}
function topModal() {
  const open = openModalStack();
  return open[open.length - 1] || null;
}

// 「这一层属于当前界面」的判据是它在文档流里的位置，不是元素清单：开着的弹窗 + 挂在 body 下自己定位的临时层
// （便条、日历、? 气泡）保持可交互，其余一律 inert——按清单写会漏掉日历那类库自己挂上去的东西。
function isActiveLayer(el) {
  if (el.classList && el.classList.contains('modal-overlay')) return el.style.display !== 'none';
  const pos = getComputedStyle(el).position;
  return pos === 'fixed' || pos === 'absolute';
}

// 背景冻结（滚动 + 交互）：**从「还有几层开着」派生**，不是开的时候 set、关的时候再 set 回去。
// 为什么不能成对 set/unset：弹窗会叠（确认框压在分类弹窗上），关掉上层时下层还开着——
// 成对的写法在这一步就把锁解了，背后的账页在「一个弹窗还开着」的状态下重新可滚。
// 同步点只有两个（openModal / closeModal），判断只有一处。
function syncScrollLock() {
  const open = openModalStack();
  document.documentElement.classList.toggle('modal-open', open.length > 0);
  // 背景整块 inert：`aria-modal="true"` 是对读屏器的承诺（背后的内容不可达），
  // 而遮罩只挡指针、焦点陷阱只挡 Tab——读屏器的虚拟光标与焦点仍然进得去，承诺就成了半句。
  // inert 是声明式的：一条规则覆盖指针/焦点/无障碍树三个入口，不必给每个背景元素各写一遍。
  // 每次全量重算（不增量维护），因为「哪些还在开着」本身就是唯一真相。
  [...document.body.children].forEach(el => {
    el.inert = open.length > 0 && !isActiveLayer(el);
  });
  syncLamp();
}

function openModal(id) {
  const modal = document.getElementById(id);
  // 打开前先记下当前焦点（就是那个触发按钮），关闭时还回去。
  // 已经开着就别再入栈：入了就成了「两层」，而关的时候只出一次——栈越积越深，
  // 之后关别的弹窗弹出的都成了过期的那一格，返回焦点整个错位。
  if (modal.style.display === 'none') __modalReturnFocus.push(document.activeElement);
  document.body.appendChild(modal);
  modal.style.display = '';
  syncScrollLock();
  // 焦点必须搬进弹窗：留在背后的话读屏器还在读背景内容，aria-modal 就是句空话。
  // 优先落在第一个表单控件上——弹窗多半是「填个表」（焦点直接放到可输入处最省一步）；
  // 没有表单控件时退到第一个可聚焦元素（如设置弹窗的分段按钮）。
  const list = modalFocusables(modal);
  // 跳过被日期选择器接管的输入框（`_flatpickr` 是它挂上去的实例）：flatpickr 默认
  // **聚焦即展开**，把焦点放到日期框上会让日历自己弹出来。用户点「复制」时想要的是
  // 「表单打开、日期默认今天」，不是「先弹一个日历给我」。日期框仍然可点、可键盘进入。
  const isPickerHost = (el) => !!el._flatpickr;
  // 参数类控件挂 data-no-autofocus：它们不是「打开这层弹窗要填的东西」，抢走焦点会把
  // 整层滚到底部（实测：设置里多一个天数输入框后，一按「设置」就跳到最下面，
  // 顶部的语言/外观被顶出视口）。表单弹窗的文本框不受影响。
  const isAutoFocusable = (el) => !isPickerHost(el) && !el.hasAttribute('data-no-autofocus');
  // 标题挂 data-autofocus 的弹窗（设置）：打开时焦点落在标题上，不落进任何输入框。
  // 设置里第一个输入框是「导出密钥」，一开面板就进密码框既容易误输入，焦点环也在页面中部；
  // 键盘用户从标题按一次 Tab 就到第一个控件（语言），顺序仍然清楚。
  const preferred = modal.querySelector('[data-autofocus]');
  const firstField = list.find(el => el.matches('input, select, textarea') && isAutoFocusable(el));
  const target = preferred || firstField || list.find(isAutoFocusable) || list[0];
  // preventScroll 是必需的：正文自带 overflow-y:auto，焦点落到最底部的「关闭」会把长表滚到最后一行。
  if (target) target.focus({ preventScroll: true });
}


// ========== SHARED HELPERS ==========
// 旭日图 tooltip 内容单一来源（三图共用）：名称与标签路径来自用户输入，必须 text.esc（renderMode 是 html）。
function sunburstTooltipContent(p, th, total, opts) {
  opts = opts || {};
  const pct = money.pctStr(p.value, total);
  const arrow = p.treePathInfo && p.treePathInfo.length > 2
    ? text.esc(p.treePathInfo[1].name) + ' › '
    : '';
  const amount = (opts.prefix ? opts.prefix + ' ' : '') + money.formatCNY(p.value);
  return `<b>${arrow}${text.esc(p.name)}</b><br/><span style="color:${th.muted}">${amount} · ${opts.pctLabel || ''}${pct}%</span>`;
}

function buildSunburstOption(data, tooltipFormatter) {
  const th = chartTheme();
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'sunburst',
      data: data,
      radius: ['12%', '97%'],
      sort: null,
      // 关掉 ECharts 原生下钻（默认 'rootToNode'）：它会维护自己的 viewRoot，
      // 与清单的选中态构成两套视图状态——「‹ 全部分类」只清了清单、图仍停在下钻层
      // （用户实测：返回全景后图上还是某个分类的值）。下钻改由选中态派生数据（chartData.sunburstDrillView）。
      nodeClick: false,
      emphasis: { focus: 'ancestor' },
      // 字色**不在这一层写**：层级 label 的函数型 color 在 ECharts 5 的 sunburst 上
      // 不保证逐节点求值（实测内环退回默认黑字，HKD 深底黑字只有 2.15:1）。
      // 改由 chartData.buildSunburstData 写在节点 label.color 上——确定生效，且色与字同表可单测。
      levels: [
        {},
        {
          r0: '12%', r: '50%',
          itemStyle: { borderWidth: 2, borderColor: th.card },
          label: { rotate: 'tangential', fontSize: 13, fontWeight: 600, fontFamily: CHART_FONT,
            minAngle: 12, // 扇区小于 12°(≈3.3%) 时隐藏标签
            formatter: function(p) { return text.truncateLabel(p.name, 13, 132); }
          }
        },
        {
          r0: '50%', r: '88%',
          itemStyle: { borderWidth: 1, borderColor: th.card },
          label: { rotate: 'radial', fontSize: 11, fontFamily: CHART_FONT,
            minAngle: 8, // 扇区小于 8°(≈2.2%) 时隐藏标签
            formatter: function(p) { return text.truncateLabel(p.name, 11, 96); }
          }
        }
      ]
    }],
    tooltip: { ...chartTooltipBase(th), formatter: tooltipFormatter }
  };
}

// 分类基础色（pill 配色）：数据源在 logic.js color.CATEGORY_COLORS——「配色 × 插值点都达 AA」要能单测（曾在这里翻车）。

// 分类 pill 配色：资产/消费共用同一套逻辑, 仅分类集合不同
function catColorImpl(cats, catId, tagName) {
  const idx = cats.findIndex(c => c.id === catId);
  const base = color.CATEGORY_COLORS[idx % color.CATEGORY_COLORS.length];
  const dark = document.documentElement.classList.contains('dark');
  const cat = cats[idx];
  const ti = cat && tagName ? cat.tags.indexOf(tagName) : -1;
  if (ti < 0 || cat.tags.length <= 1) return color.basePill(base, dark);
  return color.pillColors(base, ti / (cat.tags.length - 1), dark);
}

function rateLabelText(a, digits) {
  digits = digits || 0;
  const min = a.expectedRateMin || 0;
  const max = a.expectedRateMax || 0;
  if (min <= 0 && max <= 0) return null;
  const f = n => Number(n).toFixed(digits);
  return min === max ? `${f(min)}%` : `${f(min)}-${f(max)}%`;
}


// 压测叠加后「当前视图里的资产」（派生读数的唯一入口）；账本原值走 ledgerAssets()，名字就是判据。
function ledgerAssets() {
  return state.assets;
}

function assetsInView() {
  return stress.effectiveAssets(state.assets, state.stress);
}

// 总资产折算 CNY（资产/收益/报头多处复用同一公式，集中避免漂移）
function totalAssetsCNY() {
  return money.sumAmountCNY(assetsInView(), state.rates);
}

// 统一的分类标签 pill 渲染（资产/消费/快照列表共用），避免六处重复的内联 HTML 漂移
// opts: { showKey:false 不显示分类名, keyHtml/valHtml 自定义内部 HTML（如搜索高亮）,
//        removeFn: 'removeTag' 渲染删除按钮, renameFn: 'renameTag' 渲染重命名按钮 }
//（removeFn/renameFn 传的是函数名，除 tagPillHtml 外还有分类卡片一处开启重命名）
function tagPillHtml(cat, tagVal, colorFn, opts) {
  opts = opts || {};
  const c = colorFn(cat.id, tagVal);
  const key = opts.showKey === false ? '' : `<span class="tag-key">${opts.keyHtml != null ? opts.keyHtml : text.esc(cat.name)}</span>`;
  const val = `<span class="tag-val">${opts.valHtml != null ? opts.valHtml : text.esc(tagVal)}</span>`;
  // 改名入口 = 长按整枚胶囊（可聚焦 + Enter 直达）；长按是手势不是权限，行为由事件委托接（startTagPress → startTagRename）。
  const ren = opts.renameSide
    ? ` data-rename="${text.jsAttr(opts.renameSide || '')}" data-cat="${text.jsAttr(cat.id)}" data-tag="${text.jsAttr(tagVal)}" tabindex="0" role="button" title="${i18n.t('长按可改名')}" aria-label="${i18n.t('标签 {p1}，长按或按回车改名', { p1: tagVal })}" onkeydown="if(event.key==='Enter')renameTagFromKey(event)"`
    : '';
  const del = opts.removeSide ? ` <button class="pill-del" onclick="removeTag('${text.jsAttr(opts.removeSide)}', '${text.jsAttr(cat.id)}','${text.jsAttr(tagVal)}')" aria-label="${i18n.t('移除标签')}">✕</button>` : '';
  return `<span class="tag-pill"${ren} style="background:${c.bg};color:${c.fg};border-left-color:${c.border};">${key}${val}${del}</span>`;
}

function setScaleValue(el, readoutId) {
  el.style.setProperty('--fill', el.value + '%');
  const readout = document.getElementById(readoutId);
  if (readout) readout.textContent = el.value + '%';
}

