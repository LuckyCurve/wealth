// ========== CHART ==========
// 分类下拉统一填充（资产/消费的 5 个图表分类下拉共用），保留当前选中值
function fillCategorySelect(selId, cats) {
  const sel = document.getElementById(selId);
  if (!sel) return sel;
  const current = sel.value;
  setSelectOptions(sel, cats.map(c =>
    `<option value="${c.id}">${text.esc(c.name)}</option>`
  ).join(''));
  if (current && sel.querySelector(`option[value="${current}"]`)) sel.value = current;
}

async function renderChart() {
  const catId = document.getElementById('chart-category-select').value;
  if (!catId) return;

  const chartEl = document.getElementById('sunburst-chart');
  const emptyEl = document.getElementById('chart-empty');
  const totalEl = document.getElementById('chart-total');

  if (state.assets.length === 0) {
    showChartOrEmpty(chartEl, emptyEl, false);
    hideChartTotal(totalEl);
    renderSunburstLegend('chart-legend', [], 0, null);
    return;
  }
  showChartOrEmpty(chartEl, emptyEl, true);

  const cat = state.categories.find(c => c.id === catId);
  if (!cat) { hideChartTotal(totalEl); return; }

  const groups = {};
  cat.tags.forEach(t => { groups[t] = []; });
  assetsInView().forEach(a => {
    const tagVal = a.tags[catId];
    if (tagVal && groups[tagVal]) groups[tagVal].push(a);
  });

  const data = chartData.buildSunburstData(cat, groups, a => money.toCNY(a.amount, a.currency));

  // 所选维度下所有分组均为空（如新建分类后资产尚未分配标签）时显示空态, 避免空白画布
  if (data.length === 0) {
    showChartOrEmpty(chartEl, emptyEl, false);
    hideChartTotal(totalEl);
    renderSunburstLegend('chart-legend', [], 0, null);
    return;
  }

  // 总数 = 当前范围的合计，与 tooltip 百分比的分母**必须是同一个变量**：
  // 曾一边显示「已归类合计」一边用「全局净资产」做分母，同一张卡上两个「总数」各算各的，
  // 扇区百分比之和对不上显示的总数（口径分裂）
  const totalCNY = totalAssetsCNY();
  // 图的数据与分母都由选中态派生（图与清单不可能再漂）：下钻时图只剩该分类、
  // 分母换成该分类合计——与清单条目级占比、卡片总数三处同源
  const view = chartData.sunburstDrillView(data, totalCNY, sunburstLegendSel['chart-legend']);
  renderChartTotal(totalEl, view.total);

  const th = chartTheme();
  if (!(await chartApply({
    slot: chartSlot(() => chart, v => chart = v),
    el: chartEl,
    wire: c => wireSunburstDrill(c, 'chart-legend'),
    option: buildSunburstOption(view.data, p => sunburstTooltipContent(p, th, view.total)),
  }))) return;
  // 重绘回调登记的是**整个渲染函数**：下钻既换清单也换图，只重绘清单会让图留在上一层
  sunburstRerender['chart-legend'] = renderChart;
  renderSunburstLegend('chart-legend', view.data, view.total, chart);
}

// ========== HISTORY SNAPSHOTS ==========
function takeSnapshot() {
  document.getElementById('snapshot-note-input').value = '';
  openModal('snapshot-note-modal');
}

function confirmSnapshot(overwrite) {
  const note = document.getElementById('snapshot-note-input').value.trim();
  const month = date.getCurrentMonth();
  const existing = snapshot.findMonthSnapshot(month);

  if (existing && !overwrite) {
    closeModal('snapshot-note-modal');
    toast(i18n.t('本月已有记录，无需重复记录'), 'error');
    return;
  }

  closeModal('snapshot-note-modal');
  const snap = {
    month,
    note: note || '',
    // 快照存**原值**：它是历史事实，压测只是一组假设（见 DECISIONS.md）。
    // 金额显式走 sumAmountCNY(state.assets, ...) 而不是报头那个合计（后者已按压测叠加）
    totalCNY: money.sumAmountCNY(ledgerAssets(), state.rates),
    currencyRates: { ...state.rates },
    assets: JSON.parse(JSON.stringify(ledgerAssets())),
    updatedAt: new Date().toISOString(),
  };

  if (existing && overwrite) {
    const idx = state.snapshots.findIndex(s => s.month === month);
    state.snapshots[idx] = snap;
    toast(i18n.t('本月数据已覆盖更新'), 'success');
  } else {
    state.snapshots.push(snap);
    toast(i18n.t('快照已记录'), 'success');
  }

  saveState();
  renderAll();
  // 快照数据变化后立即重绘历史净值柱状图，无需重新进入 Tab 或刷新页面。
  // 用 afterTabPaint 而不是 setTimeout：不在「历史净值」这个 Tab 上时应当**完全不画**
  // （固定睡眠到点照画，等于在 display:none 的容器上 echarts.init 出 0×0 实例）
  afterTabPaint('history', renderHistoryChart);
}

function renderHistoryHeader() {
  const area = document.getElementById('history-record-area');
  const month = date.getCurrentMonth();
  const existing = snapshot.findMonthSnapshot(month);

  if (existing) {
    area.innerHTML = `
      <div class="row-start">
        <span class="t-body muted">
          ${date.monthLabel(month)}${i18n.t(' 已记录 ✓')}
        </span>
        <button onclick="promptOverwrite()" class="btn-ghost btn-xs">${i18n.t('覆盖更新')}</button>
      </div>
    `;
  } else {
    area.innerHTML = `<button onclick="takeSnapshot()" class="btn-gold">${i18n.t('记录本月数据')}</button>`;
  }
}

function promptOverwrite() {
  const existing = snapshot.findMonthSnapshot(date.getCurrentMonth());
  if (!existing) return;
  showConfirm(i18n.t('本月已有记录，确定覆盖更新为当前数据？'), () => {
    document.getElementById('snapshot-note-input').value = existing.note;
    confirmSnapshot(true);
    renderHistoryHeader();
  });
}

function deleteSnapshot(month) {
  showConfirm(i18n.t('确认删除该月快照？'), () => {
    state.snapshots = state.snapshots.filter(s => s.month !== month);
    saveState();
    renderHistoryTab();
    afterTabPaint('history', renderHistoryChart);
    toast(i18n.t('快照已删除'), 'success');
  });
}

// ========== 明细弹窗 / 表格骨架（唯一主人）==========
// 四处明细视图与两张对比表共用：表头行、数据行、列宽 class 与标题都只在这里生成。
function detailTableHtml(cols, head, rows) {
  const cellHtml = c => `<div${c.cls ? ` class="${c.cls}"` : ''}${c.style ? ` style="${c.style}"` : ''}>${c.html}</div>`;
  return `<div class="asset-row list-head ${cols}">${head.map(cellHtml).join('')}</div>`
    + rows.map(r => `<div class="asset-row ${cols}">${r.map(cellHtml).join('')}</div>`).join('');
}

// 明细弹窗唯一入口：标题、摘要、空态、表格都从这一份规格来。空态也要有话说，
// 否则用户看到的是一个只有表头的空表格
function openDetail(opts) {
  document.getElementById('snapshot-modal-title').textContent = opts.title;
  document.getElementById('snapshot-detail-content').innerHTML = opts.rows.length
    ? (opts.summary ? `<p class="t-body mb-4 muted">${opts.summary}</p>` : '')
      + detailTableHtml(opts.cols, opts.head, opts.rows)
    : `<p class="text-center py-8 t-body muted">${opts.empty}</p>`;
  openModal('snapshot-modal');
}

// 对比表：资产快照与消费分类两张表的列结构一致，只有首列内容、「期初/期末」措辞
// 与「新增 / 移除」徽章不同。迷你量条与百分比格仍走既有单一来源
function compareTableHtml(rows, opts) {
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.d)), 1);
  const head = [
    { html: opts.firstLabel },
    { html: opts.periods[0], cls: 'num' },
    { html: opts.periods[1], cls: 'num' },
    { html: i18n.t('变动'), cls: 'num' },
    { html: i18n.t('变动 %'), cls: 'num' },
  ];
  const body = rows.map(r => {
    const sign = r.d >= 0 ? '+' : '';
    return [
      { cls: 't-medium t-body flex items-center gap-2', html: opts.firstCellHtml(r) },
      { cls: 't-body num' + (r.status === 'new' ? ' muted' : ''), html: r.av > 0 ? money.money2(r.av) : '—' },
      { cls: 't-body num' + (r.status === 'gone' ? ' muted' : ''), html: r.bv > 0 ? money.money2(r.bv) : '—' },
      {
        cls: 't-body num',
        style: `color:${opts.color(r.d)};`,
        html: `<div class="tabular">${r.d === 0 ? '±0' : `${sign}${money.money2(r.d)}`}</div>`
          + cmpBar(r.d, maxAbs, opts.color),
      },
      { cls: 't-body num', html: cmpPctCell(r.d, r.p, opts.color) },
    ];
  });
  return detailTableHtml('cols-compare', head, body);
}

function viewSnapshot(month) {
  const snap = state.snapshots.find(s => s.month === month);
  if (!snap) return;
  openDetail({
    title: i18n.t('快照详情'),
    summary: `${date.monthLabel(snap.month)}${snap.note ? ' — ' + text.esc(snap.note) : ''} | ${i18n.t('总净值: ')}<strong>${money.formatCNY(snap.totalCNY)}</strong>`,
    cols: 'cols-snapshot',
    head: [
      { html: i18n.t('名称') }, { html: i18n.t('金额'), cls: 'num' }, { html: i18n.t('货币') },
      { html: i18n.t('预期年化'), cls: 'num' }, { html: i18n.t('标签') },
    ],
    rows: (snap.assets || []).map(a => {
      const tagHtml = Object.entries(a.tags || {}).map(([catId, val]) => {
        const cat = state.categories.find(c => c.id === catId);
        return cat ? tagPillHtml(cat, val, catColor) : '';
      }).join(' ');
      return [
        { cls: 't-medium t-body', html: text.esc(a.name) },
        { cls: 't-body num', html: money.money2(a.amount) },
        { cls: 't-body muted', html: a.currency },
        { cls: 't-body num', html: rateLabelText(a) || '<span class="muted hint-xs">' + i18n.t('未设置') + '</span>' },
        { cls: 'flex flex-wrap gap-1', html: tagHtml },
      ];
    }),
    empty: i18n.t('该快照没有资产记录'),
  });
}

// ========== SEGMENT DRILL-DOWN ==========
// 堆叠柱下钻：点击「历史净值/消费趋势」中某月某标签的色块，
// 在快照弹窗中展开该色块的组成明细。金额口径与图表一致：
// 历史按快照当时 currencyRates 折算 CNY；消费直接用记录金额。
function viewHistorySegment(month, catId, tag) {
  const snap = state.snapshots.find(s => s.month === month);
  const cat = state.categories.find(c => c.id === catId);
  if (!snap || !cat) return;
  const rates = snap.currencyRates || {};
  const items = (snap.assets || [])
    .filter(a => (a.tags || {})[catId] === tag)
    .map(a => Object.assign({}, a, { cny: money.amountAtRates(a.amount, a.currency, rates) }))
    .sort((a, b) => b.cny - a.cny);
  if (items.length === 0) return;
  const segTotal = items.reduce((s, a) => s + a.cny, 0);
  openDetail({
    title: date.monthLabel(month) + ' · ' + tag + i18n.t('构成'),
    summary: `${text.esc(cat.name)} › ${text.esc(tag)} | ${i18n.t('{p1} 项资产 | 合计 ', { p1: items.length })}<strong>${money.formatCNY(segTotal)}</strong>`,
    cols: 'cols-segment',
    head: [
      { html: i18n.t('名称') }, { html: i18n.t('金额'), cls: 'num' }, { html: i18n.t('货币') },
      { html: i18n.t('折算 CNY'), cls: 'num' }, { html: i18n.t('占比'), cls: 'num' },
    ],
    rows: items.map(a => ([
      { cls: 't-medium t-body', html: text.esc(a.name) },
      { cls: 't-body num', html: money.money2(a.amount) },
      { cls: 't-body muted', html: a.currency },
      { cls: 't-body num', html: money.formatCNY(a.cny) },
      { cls: 't-body num muted', html: `${money.pctStr(a.cny, segTotal)}%` },
    ])),
    empty: i18n.t('该标签下没有资产'),
  });
}

// ========== SNAPSHOT COMPARE ==========
// 对比基准默认口径在 logic.js snapshot.defaultCompareBaseMonth：默认与最新月构成「最近两个月」对比。
function openCompareModal() {
  const sorted = [...state.snapshots].sort((a, b) => a.month.localeCompare(b.month));
  if (sorted.length < 2) { toast(i18n.t('至少需要两个月的快照才能对比'), 'error'); return; }
  const baseSel = document.getElementById('compare-base-select');
  const targetSel = document.getElementById('compare-target-select');
  const months = sorted.map(s => s.month);
  const opts = date.monthsDesc(months).map(m => `<option value="${m}">${date.monthLabel(m)}</option>`).join('');
  baseSel.innerHTML = opts;
  targetSel.innerHTML = opts;
  // 默认最近两个月：起始=次新月，结束=最新月；不保留上次选择
  baseSel.value = snapshot.defaultCompareBaseMonth(sorted);
  targetSel.value = sorted[sorted.length - 1].month;
  openModal('compare-modal');
  renderCompareTable();
}

function renderCompareTable() {
  const baseSnap = state.snapshots.find(s => s.month === document.getElementById('compare-base-select').value);
  const compSnap = state.snapshots.find(s => s.month === document.getElementById('compare-target-select').value);
  if (!baseSnap || !compSnap) return;
  const container = document.getElementById('compare-detail-content');
  const heroEl = document.getElementById('compare-hero');
  const ctxEl = document.getElementById('compare-context');

  const cnyAt = (snap, a) => money.amountAtRates(a.amount, a.currency, snap.currencyRates || {});
  const baseTotal = baseSnap.totalCNY || baseSnap.assets.reduce((s, a) => s + cnyAt(baseSnap, a), 0);
  const compTotal = compSnap.totalCNY || compSnap.assets.reduce((s, a) => s + cnyAt(compSnap, a), 0);
  const diff = compTotal - baseTotal;
  renderCompareHero(heroEl, ctxEl, diff, baseTotal, compTotal, date.monthLabel(baseSnap.month), date.monthLabel(compSnap.month), true);

  const baseMap = new Map((baseSnap.assets || []).map(a => [a.id, a]));
  const compMap = new Map((compSnap.assets || []).map(a => [a.id, a]));
  const orderedIds = [...baseMap.keys(), ...[...compMap.keys()].filter(id => !baseMap.has(id))];
  const rows = orderedIds.map(id => {
    const a = baseMap.get(id), b = compMap.get(id);
    const av = a ? cnyAt(baseSnap, a) : 0;
    const bv = b ? cnyAt(compSnap, b) : 0;
    return {
      name: (a || b).name, cur: (a || b).currency, av, bv,
      d: bv - av,
      p: av > 0 ? (bv - av) / av * 100 : null,
      status: !a ? 'new' : (!b ? 'gone' : 'same'),
    };
  });

  if (rows.length === 0) {
    container.innerHTML = '<p class="text-center py-8 t-body muted">' + i18n.t('两个月份均无资产记录') + '</p>';
    return;
  }

  container.innerHTML = compareTableHtml(rows, {
    firstLabel: i18n.t('资产'),
    periods: [i18n.t('期初'), i18n.t('期末')],
    color: v => compareColor(v, true),
    firstCellHtml: r => text.esc(r.name) + `<span class="t-micro muted">${r.cur}</span>`
      + (r.status === 'new' ? '<span class="mo-badge up">' + i18n.t('新增') + '</span>'
        : r.status === 'gone' ? '<span class="mo-badge down">' + i18n.t('移除') + '</span>' : ''),
  });
}

function loadDemoData() {
  if (state.assets.length > 0 || state.snapshots.length > 0) {
    showConfirm(i18n.t('导入示例数据将覆盖当前所有数据，确认继续？'), () => doLoadDemoData());
    return;
  }
  doLoadDemoData();
}
function doLoadDemoData() {
  const currencyCat = state.categories.find(c => c.id === 'currency');
  const data = demo.assetDemo({ now: new Date(), genId, currencyCat });
  state.rates = data.rates;
  state.categories = data.categories;
  state.assets = data.assets;
  state.snapshots = data.snapshots;
  saveState();
  renderAll();
  toast(i18n.t('示例数据已导入（6个月快照）'), 'success');
}

function setHistoryChartMode(mode) {
  historyChartMode = mode;
  setSegMode('hist-mode-value', 'hist-mode-percent', mode, 'value', 'percent', renderHistoryChart);
}

async function renderHistoryChart() {
  const catId = document.getElementById('history-category-select').value;
  const chartEl = document.getElementById('history-chart');
  const emptyEl = document.getElementById('history-empty');

  if (state.snapshots.length < 2) { histDrillMeta = null; showChartOrEmpty(chartEl, emptyEl, false); return; }
  showChartOrEmpty(chartEl, emptyEl, true);

  const cat = state.categories.find(c => c.id === catId);
  if (!cat) { histDrillMeta = null; return; }

  const th = chartTheme();
  const sorted = [...state.snapshots].sort((a, b) => a.month.localeCompare(b.month));
  const dates = sorted.map(s => date.monthLabel(s.month));

  const totals = sorted.map(s => s.totalCNY);

  // 每月「标签→金额」映射（按快照当时汇率折算）：排序与系列数据共用，避免重复聚合；
  // 标签顺序按跨月合计降序（大的放堆叠柱底部，小的在上，与消费趋势一致）
  const monthTagValues = sorted.map(snap => {
    const m = {};
    cat.tags.forEach(tag => {
      m[tag] = (snap.assets || [])
        .filter(a => (a.tags || {})[catId] === tag)
        .reduce((s, a) => s + money.amountAtRates(a.amount, a.currency, snap.currencyRates), 0);
    });
    return m;
  });
  const sortedTags = chartData.sortTagsByTotal(cat, monthTagValues);

  histDrillMeta = {
    catId: catId,
    months: sorted.map(s => s.month),
    tags: sortedTags,
  };

  const series = sortedTags.map((tag, si) => {
    const isLast = si === sortedTags.length - 1;
    const raw = monthTagValues.map(m => m[tag]);
    const data = historyChartMode === 'percent'
      ? chartData.percentSeriesData(raw, totals)
      : raw;
    return {
      ...barSeriesStyle(cat, tag),
      data,
      label: isLast && historyChartMode === 'value' ? {
        show: true,
        position: 'top',
        formatter: function(p) { return money.formatCNY(totals[p.dataIndex]); },
        fontFamily: CHART_FONT,
        fontSize: 11,
        color: th.muted,
      } : undefined,
    };
  });

  const option = {
    // 回灌前清理失效项（局部副本，不回写存储）
    ...barChartBase(th, dates, historyChartMode, sortedTags, chartData.pruneLegendSelected(histLegendSel, sortedTags)),
    tooltip: {
      ...chartTooltipBase(th),
      formatter: function(p) {
        const idx = p.dataIndex;
        const d = dates[idx];
        const total = totals[idx];
        if (historyChartMode === 'percent') {
          const raw = p.data && p.data.raw != null ? p.data.raw : 0;
          return `<b>${d}</b><br/>${p.marker} ${text.esc(p.seriesName)}: ${p.value}% (${money.formatCNY(raw)})`;
        }
        const pct = money.pctStr(p.value, total);
        return `<b>${d}</b><br/>${p.marker} ${text.esc(p.seriesName)}: ${money.formatCNY(p.value)} (${pct}%)`;
      }
    },
    series
  };
  if (!(await chartApply({
    slot: chartSlot(() => historyChart, v => historyChart = v),
    el: chartEl,
    wire: c => {
      // 图例选中态记忆：用户点击图例隐藏/显示系列时保存，重绘后回灌（切模式/切主题不丢）
      c.on('legendselectchanged', p => { histLegendSel = p.selected; });
      wireStackedBarDrill(c, () => histDrillMeta, viewHistorySegment);
    },
    option: option,
  }))) return;
}

// 月度环比徽章 / 对比行（资产快照与消费趋势共用，单一来源）：
// curr/prev 为数值，prev=null 表示无上月（首月），prev=0 表示新增；
// goodWhenUp=true 时「上涨=好=绿」（资产净值），false 时「上涨=坏=红」（消费支出）
function momCompareHtml(curr, prev, goodWhenUp) {
  if (prev == null) return { badge: '<span class="mo-badge first">' + i18n.t('首月') + '</span>', diffLine: '' };
  if (prev === 0) return { badge: '<span class="mo-badge up">' + i18n.t('新增') + '</span>', diffLine: '' };
  const m = expense.expenseMoM(curr, prev);
  const sign = m.up ? '+' : '';
  const good = goodWhenUp ? m.up : !m.up;
  const badgeClass = good ? 'up' : 'down';
  const diffColor = good ? 'var(--verdigris)' : 'var(--down)';
  const badge = '<span class="mo-badge ' + badgeClass + '" title="' + i18n.t('较上月 ') + sign + money.formatCNY(m.diff) + '（' + sign + m.pct.toFixed(1) + '%）">' + (m.up ? '▲' : '▼') + ' ' + sign + m.pct.toFixed(1) + '%</span>';
  // 小条按「本月差额 / 本月总额」相对归一（与前月同量级才可比），精确金额仍在文字里。
  // 条挂在文字前：先看到方向，再读到数；零差额不画条。
  const bar = cmpMiniBar(m.diff, Math.max(Math.abs(curr), Math.abs(prev)) || 1, () => diffColor);
  const diffLine = '<span style="color:' + diffColor + ';">' + bar + i18n.t('较上月 ') + sign + money.formatCNY(m.diff) + '</span>';
  return { badge: badge, diffLine: diffLine };
}

function compareColor(v, goodWhenUp) {
  if (v === 0) return 'var(--muted)';
  const good = goodWhenUp ? v > 0 : v < 0;
  return good ? 'var(--verdigris)' : 'var(--down)';
}

function renderHistoryTab() {
  renderHistoryHeader();
  const list = document.getElementById('snapshots-list');
  if (state.snapshots.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = [...state.snapshots].sort((a, b) => b.month.localeCompare(a.month)).map(s => {
    const prev = snapshot.getPrevSnapshot(s.month);
    const { badge, diffLine } = momCompareHtml(s.totalCNY, prev ? prev.totalCNY : null, true);
    return `<div class="card card-interactive snapshot-row">
      <div class="row-main row-hit" role="button" tabindex="0" onclick="viewSnapshot('${text.jsAttr(s.month)}')"
        onkeydown="if(ui.activateKeyAction(event.key)){event.preventDefault();viewSnapshot('${text.jsAttr(s.month)}');}">
        <div class="row-start">
          <span class="t-medium t-body">${date.monthLabel(s.month)}</span>
          ${badge}
        </div>
        <div class="t-micro mt-0.5 muted">${text.esc(s.note) || i18n.t('无备注')} · ${money.formatCNY(s.totalCNY)} · ${i18n.t('{p1} 项资产', { p1: (s.assets || []).length })}${diffLine ? ' · ' + diffLine : ''}</div>
      </div>
      <button onclick="deleteSnapshot('${text.jsAttr(s.month)}')" class="row-btn danger">${i18n.t('删除')}</button>
    </div>`;
  }).join('');
}

function onIncomeSafetyInput() {
  const el = document.getElementById('income-safety-input');
  const v = parseFloat(el.value);
  setScaleValue(el, 'income-safety-readout');
  if (v !== state.incomeSafetyFactor) {
    state.incomeSafetyFactor = v;
    saveState();
    // 安全边际同时作用于两口径与报头副行 → 同一收尾口
    syncDerivedReads();
  }
}

// 收益口径（最低/最高）是全局读数：收益表、覆盖标尺、报头副行都用同一档。
// 切换后走同一收尾口重算，而不是只刷收益页（曾经报头副行停在上一个口径）。
function setIncomeMode(mode) {
  incomeMode = mode;
  setSegMode('income-mode-min', 'income-mode-max', mode, 'min', 'max', () => syncDerivedReads());
}

// ========== 覆盖标尺（月收益对预期月消费的覆盖率）==========
// 分子口径 cash/total 可切换（不持久化）；口径与三态文案在 logic.js income.coveragePct / income.incomeGap。
function renderCoverageMeter() {
  const invite = document.getElementById('cov-invite');
  const section = document.getElementById('cov-section');
  if (!invite || !section) return;
  const expectation = state.expenseExpectation || 0;
  if (!(expectation > 0)) {
    invite.style.display = '';
    section.style.display = 'none';
    return;
  }
  invite.style.display = 'none';
  section.style.display = '';

  // 两口径合计与报头同源（logic.js income.sumAssetIncomes; 年值供缺口外推用同一份, 不另算）
  const { monthly, cashMonthly, annual, cashAnnual } = income.sumAssetIncomes(assetsInView());
  const numerator = coverageMode === 'total' ? monthly : cashMonthly;
  document.getElementById('cov-anchor-num').textContent = money.formatCNY(numerator);
  document.getElementById('cov-anchor-expense').textContent = money.formatCNY(expectation);

  // expectation > 0 已保证, income.coveragePct 不返回 null
  const pct = income.coveragePct(numerator, expectation);
  const covered = Math.min(100, Math.max(0, pct));
  document.getElementById('cov-fill').style.width = covered + '%';
  document.getElementById('cov-marker').style.left = covered + '%';

  const reading = document.getElementById('cov-reading');
  // 指引分支仅现金口径有意义; 总收益口径下有息资产必使分子 > 0
  if (coverageMode === 'cash' && cashMonthly <= 0) {
    reading.textContent = i18n.t('当前组合没有现金流收益——调高资产的现金比例后，这里开始计量');
    return;
  }
  // 差额与打平判定同源（logic.js income.incomeGap, 覆盖标尺为盈余/缺口唯一渲染出口, 报头已不再重复渲染）
  const g = income.incomeGap(numerator, expectation);
  const ok = g.ok;
  const diffColor = g.ok ? 'var(--verdigris)' : 'var(--down)';
  // 缺口分支挂「还需本金」Tips: 按当前口径（分子/利率档/安全边际）线性外推, 算式在 logic.js（单一来源）
  let shortfallTip = '';
  if (!ok) {
    const annualBase = coverageMode === 'total' ? annual : cashAnnual;
    const principal = income.ratedPrincipalCNY(assetsInView());
    const { need, rate } = income.coverShortfallPrincipal(numerator, expectation, annualBase, principal);
    shortfallTip = shortfallTipHtml(need, rate);
  }
  dropDetachedBubbles(); // 先扔掉上一帧挂在 body 上的气泡（见函数注释）
  reading.innerHTML =
    `<span>${i18n.t('覆盖 ')}<span class="tabular readout-strong" style="color:${ok ? 'var(--verdigris)' : 'var(--fg)'};opacity:${ok ? '1' : '0.85'};">${pct.toFixed(1)}%</span></span>` +
    ` · <span>${g.word} <span class="tabular readout-strong" style="color:${diffColor};">¥${g.amt.toLocaleString('zh-CN')}</span>${i18n.t('/月')}</span>` +
    shortfallTip +
    (ok ? ` <span class="mo-badge up" title="${i18n.t(coverageMode === 'total' ? '总收益' : '现金收益')}${i18n.t('已完全覆盖预期月消费')}">${i18n.t('已覆盖')}</span>` : '');
}

// 缺口「还需本金」气泡文案（Tips 唯一拼装处）: 算式与口径在 logic.js, 这里只做展示。
// need 为 null（已覆盖/预期非法）→ 不挂图标; Infinity（实际年化 ≤ 0）→ 兜底一句（收益率不成立, 无从外推）。
function shortfallTipHtml(need, rate) {
  if (need === null) return '';
  const body = need === Infinity
    ? i18n.t('当前资产的实际年化不高，加本金也补不上这个缺口——先调高预期年利率或降低月消费。')
    : `${i18n.t('按当前实际年化 {p1}% 线性外推，还需本金 ', { p1: rate.toFixed(2) })}<span class="tabular readout-strong">${money.formatCNY(need)}</span>${i18n.t(' 才能覆盖。')}`;
  return `<span class="tip">` +
    `<button type="button" class="tip-mark" aria-describedby="cov-shortfall-tip" aria-label="${i18n.t('还需多少本金才能覆盖')}">?</button>` +
    `<span class="tip-bubble" id="cov-shortfall-tip" role="tooltip">${body}</span></span>`;
}

let coverageMode = 'total'; // 覆盖标尺分子口径, 默认总收益（含增值宽松口径）; 不持久化与 incomeChartMode 同惯例
function setCoverageMode(mode) {
  if (mode !== 'cash' && mode !== 'total') return;
  coverageMode = mode;
  setSegMode('cov-mode-cash', 'cov-mode-total', mode, 'cash', 'total', () => renderCoverageMeter());
}

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

// ========== 所选标签的钱 ÷ 月消费（消费趋势的读数卡）==========
// 分母默认全局预期、可在弹窗自定（只对本卡生效）；全局未设则整卡不显示。口径在 logic.js income.runway*。
function renderRunwayRow() {
  const card = document.getElementById('runway-card');
  const guide = document.getElementById('runway-guide');
  const line = document.getElementById('runway-reading');
  if (!card || !guide || !line) return;
  const expectation = income.runwayExpectationOf(state.runwayExpectation, state.expenseExpectation);
  if (!(expectation > 0)) {
    card.style.display = 'none';
    return;
  }
  // 引用先过同一清理入口: 手改/损坏的数据里可能有畸形引用（不仅不计数, 也不能在标签摘要里渲染成 undefined）,
  // 且非数组时 refs.map 会直接抛错; 清理后的 refs 与 income.runwayLiquidCNY 的匹配集合必然一致
  const refs = income.pruneRunwayTags(state.runwayTags, state.categories);
  const liquid = income.runwayLiquidCNY(assetsInView(), refs);
  card.style.display = '';
  // 未选标签（null）与选了但无资产命中（0）区分开: 前者走指引句
  const chosen = liquid != null;
  guide.style.display = chosen ? 'none' : '';
  line.style.display = chosen ? '' : 'none';
  if (!chosen) return;
  // 只同步文案: 公式骨架在 HTML 里静态可见（÷ 与 = 写在结构里）, 这里不拼 HTML
  document.getElementById('runway-tags-label').textContent = refs.map(r => r.tag).join(' · ');
  document.getElementById('runway-num').textContent = money.formatCNY(liquid);
  // 分母名要标出「自定」: 自定值只作用于本卡, 不换名会与旁边的覆盖标尺（仍是全局预期）看着像同一个数
  document.getElementById('runway-expense-name').textContent =
    income.runwayExpectationIsCustom(state.runwayExpectation) ? i18n.t('月消费（自定）') : i18n.t('预期月消费');
  document.getElementById('runway-expense').textContent = money.formatCNY(expectation);
  document.getElementById('runway-months').textContent = income.runwayMonthsText(income.runwayMonths(liquid, expectation));
}

// 标签与月消费（草稿）: 打开只拷草稿、保存才落 state —— 取消不落库（与预期消费弹窗同惯例）
let _runwayDraft = [];
function openRunwayModal() {
  _runwayDraft = income.pruneRunwayTags(state.runwayTags, state.categories);
  // 默认带出已填的月消费（自定值优先, 否则全局「预期月消费」）: 字段里就是当前生效的数, 改一个数即可, 不必重敲
  document.getElementById('runway-expectation').value =
    money.moneyStr(income.runwayExpectationOf(state.runwayExpectation, state.expenseExpectation));
  renderRunwayTagGroups();
  renderRunwayPreview();
  openModal('runway-modal');
}

// 「默认」= 把字段填回全局「预期月消费」（值可见, 不必记住原数字）; 保存时与它相同的值即按默认存（0）
function useDefaultRunwayExpectation() {
  document.getElementById('runway-expectation').value = money.moneyStr(state.expenseExpectation);
  renderRunwayPreview();
}

// ========== 本月已花 ÷ 预期月消费（趋势页预算卡）==========
// 不拿时间进度做基准（大额固定支出会让它失真），只报剩余预算与「每天还能花多少」；口径在 logic.js expense.monthBudget*。
function renderMonthPace() {
  const card = document.getElementById('month-pace-card');
  if (!card) return;
  const expectation = state.expenseExpectation || 0;
  if (!(expectation > 0)) {
    card.style.display = 'none';
    return;
  }
  // 合计与读数必须取同一时刻: 各自 new Date 会在跨午夜瞬间分属两个月（合计旧月、读数新月）
  const now = new Date();
  const spent = expense.monthExpenseTotal(state.expenses, date.getLocalMonthStr(now));
  const reading = expense.monthBudgetReading(spent, expectation, now);
  card.style.display = '';
  const fill = document.getElementById('pace-fill');
  fill.style.width = Math.min(100, Math.max(0, reading.pctOfMonth)) + '%';
  fill.style.background = reading.over ? 'var(--down)' : (reading.pctOfMonth >= 90 ? 'var(--warning)' : 'var(--verdigris)');
  document.getElementById('pace-num').textContent = money.formatCNY(spent);
  document.getElementById('pace-expense').textContent = money.formatCNY(expectation);
  const pct = document.getElementById('pace-pct');
  // 百分比读数取 reading.pctOfMonth（与尺子宽度、≥90% 判断同源）, 不用 spent/expectation 另算一遍
  pct.textContent = money.pctStr(reading.pctOfMonth, 100) + '%';
  pct.style.color = reading.over ? 'var(--down)' : (reading.pctOfMonth >= 90 ? 'var(--warning)' : 'var(--accent-ink)');
  const note = document.getElementById('pace-note');
  const noteText = expense.monthBudgetNote(reading);
  note.textContent = noteText;
  note.style.display = noteText ? '' : 'none';
  note.style.color = reading.over ? 'var(--down)' : 'var(--muted)';
}

// 分组多选 chips: 复用录入表单同款 chip 视觉（tagChipHtml）, 分组头不可选
function renderRunwayTagGroups() {
  const box = document.getElementById('runway-tag-groups');
  if (!box) return;
  const cats = state.categories.filter(c => c && Array.isArray(c.tags));
  if (cats.length === 0) {
    box.innerHTML = '<p class="t-body muted">' + i18n.t('先去「分类管理」建一个资产分类和标签。') + '</p>';
    return;
  }
  box.innerHTML = cats.map(cat => {
    const chips = cat.tags.map(t => tagChipHtml(
      cat.id, t,
      _runwayDraft.some(r => r.catId === cat.id && r.tag === t),
      `data-cat="${text.esc(cat.id)}" data-tag="${text.esc(t)}" onclick="toggleRunwayTag(this)"`,
      catColor)).join('');
    return `<div>
      <label class="field-label">${text.esc(cat.name)}</label>
      <div class="tag-picker">${chips}</div>
    </div>`;
  }).join('');
}

function toggleRunwayTag(btn) {
  const catId = btn.dataset.cat, tag = btn.dataset.tag;
  const i = _runwayDraft.findIndex(r => r.catId === catId && r.tag === tag);
  const adding = i < 0; // 先定语义再改数组: 否则 splice 后就分不出「加」还是「删」
  if (adding) _runwayDraft.push({ catId, tag }); else _runwayDraft.splice(i, 1);
  btn.setAttribute('aria-pressed', adding ? 'true' : 'false');
  renderRunwayPreview();
}

// 弹窗内实时预览: 勾选/改月消费即见结果（同一口径函数, 与读数行同算式）, 不必保存了才知道。
// 输入解析与归一与写入侧共用 income.normalizeRunwayExpectationInput: 两处各写一份时值恰好等价, 但
// 一旦只改一处（如把「与全局相同」的判定收掉）预览与保存后的读数就会对不上, 而这类分家不会报错。
function renderRunwayPreview() {
  const el = document.getElementById('runway-preview');
  if (!el) return;
  const input = document.getElementById('runway-expectation').value;
  const expectation = income.runwayExpectationOf(income.normalizeRunwayExpectationInput(input, state.expenseExpectation), state.expenseExpectation);
  const liquid = income.runwayLiquidCNY(assetsInView(), _runwayDraft);
  if (liquid == null) { el.textContent = i18n.t('勾选标签后这里显示结果'); return; }
  const months = income.runwayMonths(liquid, expectation);
  if (months == null) { el.textContent = i18n.t('先设定预期月消费，再回来看结果'); return; }
  el.textContent = i18n.t('{p1} ÷ 月消费 {p2} = {p3}', { p1: money.formatCNY(liquid), p2: money.formatCNY(expectation), p3: income.runwayMonthsText(months) });
}

function saveRunwayTags() {
  state.runwayTags = income.pruneRunwayTags(_runwayDraft, state.categories);
  // 自定月消费: 只写读数卡自己的字段, 绝不回填 state.expenseExpectation（全局预期由「预期消费」弹窗独占）
  state.runwayExpectation = income.normalizeRunwayExpectationInput(
    document.getElementById('runway-expectation').value, state.expenseExpectation);
  saveState();
  closeModal('runway-modal');
  renderRunwayRow();
  toast(state.runwayExpectation > 0 ? i18n.t('已更新标签与月消费') : i18n.t('已更新标签'), 'success');
}

function renderIncomeTab() {
  const empty = document.getElementById('income-empty');
  const summary = document.getElementById('income-summary');
  const table = document.getElementById('income-table-container');
  const chartContainer = document.getElementById('income-chart-container');

  // 安全边际滑块与状态同步（用户拖动中不打断）
  const safetyEl = document.getElementById('income-safety-input');
  if (document.activeElement !== safetyEl) {
    if (safetyEl.value !== String(state.incomeSafetyFactor)) safetyEl.value = String(state.incomeSafetyFactor);
    setScaleValue(safetyEl, 'income-safety-readout');
  }

  const hasAnyRate = income.hasAnyRatedAsset(assetsInView()); // 与 masthead 同一判定（logic.js），同经压测叠加
  document.getElementById('income-mode-toggle').style.display = hasAnyRate ? '' : 'none';

  const assets = assetsInView().filter(a => income.getAssetRate(a) > 0);

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
  chartContainer.style.display = ''; // 走到这里 assets 必非空（空集已在上面 return）

  // --- Summary ---
  // 两口径合计单一来源（logic.js income.sumAssetIncomes, 与报头副行/覆盖标尺共用）
  const sums = income.sumAssetIncomes(assetsInView());
  const totalAnnual = sums.annual;
  const totalMonthly = sums.monthly;
  const totalDaily = sums.daily;
  const totalCNY = totalAssetsCNY();
  const cashAnnual = sums.cashAnnual;
  const cashMonthly = sums.cashMonthly;

  document.getElementById('income-monthly').textContent = money.formatCNY(totalMonthly);
  document.getElementById('income-cash-monthly').textContent = money.formatCNY(cashMonthly);
  document.getElementById('income-annual').textContent = money.formatCNY(totalAnnual);
  document.getElementById('income-daily').textContent = money.formatCNY(totalDaily);
  document.getElementById('income-cash-share').textContent = totalAnnual > 0
    ? (cashAnnual / totalAnnual * 100).toFixed(0) + '%' : '—';

  // Weighted average rate (总收益与现金收益各自加权平均，安全边际因子相消不影响均值)
  const totalWeighted = assets.reduce((s, a) => {
    const cny = money.toCNY(a.amount, a.currency);
    return s + cny * income.getAssetRate(a);
  }, 0);
  const cashWeighted = assets.reduce((s, a) => {
    const cny = money.toCNY(a.amount, a.currency);
    return s + cny * income.getAssetRate(a) * income.getCashRatio(a);
  }, 0);
  // 有息本金（CNY）单一来源（logic.js income.ratedPrincipalCNY）: 页脚加权平均利率与缺口外推的「还需本金」
  // 必须同基地 —— 两处各写一份 reduce 时, 改一处忘另一处会让页脚均值与外推年化对不上且不报错
  const totalAssetCNY = income.ratedPrincipalCNY(assetsInView());
  const avgRate = totalAssetCNY > 0 ? (totalWeighted / totalAssetCNY).toFixed(2) : '0.00';
  const avgCashRate = totalAssetCNY > 0 ? (cashWeighted / totalAssetCNY).toFixed(2) : '0.00';
  const safetyPct = state.incomeSafetyFactor || 100;
  const discounted = safetyPct < 100;
  document.getElementById('income-summary-footer').textContent =
    i18n.t('加权平均利率 {p1}% · 平均现金收益率 {p2}% · 总资产 {p3}', { p1: avgRate, p2: avgCashRate, p3: money.formatCNY(totalCNY) }) +
    (discounted ? i18n.t(' · 已按 {p1}% 安全边际折算', { p1: safetyPct }) : '');

  // 覆盖标尺（覆盖率/差额口径在 logic.js income.coveragePct/income.incomeGap）
  renderCoverageMeter();

  const sorted = [...assetsInView()].sort((a, b) => {
    return income.calcAssetIncome(b).monthly - income.calcAssetIncome(a).monthly;
  });
  const rows = document.getElementById('income-rows');
  rows.innerHTML = [
    '<div class="asset-row list-head cols-income">',
    `  <div>${i18n.t('名称')}</div><div class="num">${i18n.t('金额 (CNY)')}</div><div class="num">${i18n.t('年利率')}</div><div class="num">${i18n.t('现金比例')}</div><div class="num">${i18n.t('年收益')}${discounted ? '*' : ''}</div><div class="num">${i18n.t('月收益')}${discounted ? '*' : ''}</div><div class="num">${i18n.t('现金/月')}${discounted ? '*' : ''}</div>`,
    '</div>',
    ...sorted.map(a => {
      const inc = income.calcAssetIncome(a);
      const hasRate = income.getAssetRate(a) > 0;
      const rowClass = 'asset-row cols-income' + (hasRate ? '' : ' is-unrated');
      const rateLabel = rateLabelText(a, 1) || '<span class="muted">' + i18n.t('未设置') + '</span>';
      const cashPct = income.cashRatioPct(a);
      return `<div class="${rowClass}">
        <div class="t-medium t-body">${text.esc(a.name)}</div>
        <div class="t-body num">${money.money2(inc.cny)}</div>
        <div class="t-body num">${rateLabel}</div>
        <div class="t-body num">${hasRate ? cashPct + '%' : '-'}</div>
        <div class="t-body num">${hasRate ? money.formatCNY(inc.annual) : '-'}</div>
        <div class="t-body num">${hasRate ? money.formatCNY(inc.monthly) : '-'}</div>
        <div class="t-body num ink-accent">${hasRate ? money.formatCNY(inc.cashMonthly) : '-'}</div>
      </div>`;
    }).join('')
  ].join('');

  const noteEl = document.getElementById('income-table-note');
  noteEl.style.display = discounted ? '' : 'none';
  noteEl.textContent = discounted ? i18n.t('* 已按 {p1}% 安全边际折算', { p1: safetyPct }) : '';

  fillCategorySelect('income-chart-category-select', state.categories);
  renderIncomeChart();
}

let incomeChart = null;
let incomeMode = 'min';
let incomeChartMode = 'cash'; // 收益分布旭日图口径: 'cash' 现金收益 | 'total' 总收益

function setIncomeChartMode(mode) {
  incomeChartMode = mode;
  setSegMode('income-chart-mode-cash', 'income-chart-mode-total', mode, 'cash', 'total', renderIncomeChart);
}

async function renderIncomeChart() {
  const catId = document.getElementById('income-chart-category-select').value;
  if (!catId) return;

  const el = document.getElementById('income-chart');

  const rateAssets = assetsInView().filter(a => income.getAssetRate(a) > 0);
  if (rateAssets.length === 0) {
    el.style.display = 'none';
    renderSunburstLegend('income-chart-legend', [], 0, null);
    return;
  }
  el.style.display = '';

  const cat = state.categories.find(c => c.id === catId);
  if (!cat) return;

  const groups = {};
  cat.tags.forEach(t => { groups[t] = []; });
  rateAssets.forEach(a => {
    const tagVal = a.tags[catId];
    if (tagVal && groups[tagVal]) {
      groups[tagVal].push({ name: a.name, asset: a, extra: { _assetId: a.id } });
    }
  });

  const modeLabel = incomeChartMode === 'cash' ? i18n.t('月现金收益') : i18n.t('月总收益');
  const totalIncome = rateAssets.reduce((s, a) => {
    const inc = income.calcAssetIncome(a);
    return s + (incomeChartMode === 'cash' ? inc.cashMonthly : inc.monthly);
  }, 0);

  const data = chartData.buildSunburstData(cat, groups, ch => {
    const inc = income.calcAssetIncome(ch.asset);
    return incomeChartMode === 'cash' ? inc.cashMonthly : inc.monthly;
  });

  if (data.length === 0) {
    el.style.display = 'none';
    renderSunburstLegend('income-chart-legend', [], 0, null);
    return;
  }

  const th = chartTheme();
  // 图与清单同源：下钻后分母换成该分类合计（与卡片总数、tooltip、清单三处同口径）
  const view = chartData.sunburstDrillView(data, totalIncome, sunburstLegendSel['income-chart-legend']);
  const option = buildSunburstOption(view.data, function(p) {
    // ECharts 不会把 data 上的自定义字段展开到 params 顶层, 必须从 p.data 取
    const assetId = p.data && p.data._assetId;
    if (assetId) {
      // 从**视图资产**里找：扇区是压测后的数，tooltip 也必须是同一个数
      const a = assetsInView().find(x => x.id === assetId);
      if (a) {
        const inc = income.calcAssetIncome(a);
        const rateRange = rateLabelText(a, 1) || i18n.t('未设置');
        return `<b>${text.esc(a.name)}</b><br/>${i18n.t('月现金收益 ')}${money.formatCNY(inc.cashMonthly)} · ${i18n.t('月总收益 ')}${money.formatCNY(inc.monthly)}<br/><span style="color:${th.muted}">${i18n.t('利率 ')}${rateRange} · ${i18n.t('现金 ')}${income.cashRatioPct(a)}% · ${i18n.t('占比 ')}${money.pctStr(p.value, view.total)}%</span>`;
      }
    }
    return sunburstTooltipContent(p, th, view.total, { prefix: modeLabel, pctLabel: i18n.t('占比 ') });
  });
  if (!(await chartApply({
    slot: chartSlot(() => incomeChart, v => incomeChart = v),
    el: el,
    wire: c => wireSunburstDrill(c, 'income-chart-legend'),
    option: option,
  }))) return;
  // 重绘回调登记的是**整个渲染函数**：下钻既换清单也换图，只重绘清单会让图留在上一层
  sunburstRerender['income-chart-legend'] = renderIncomeChart;
  renderSunburstLegend('income-chart-legend', view.data, view.total, incomeChart);
}

