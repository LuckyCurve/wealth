// ========== STATE ==========
const LS_KEY = 'wealth-manager-data';
// 应用初始状态（单一来源）：顶层 state 与 loadState 异常回退共用，
// 保证损坏的 localStorage 不会残留半解析状态（rates/backup/预期等）。
function freshAppState() {
  return {
    categories: [], assets: [], snapshots: [],
    expenseCategories: [], expenses: [],
    rates: { CNY: 1, HKD: 1, USD: 1, fetchedAt: null },
    expenseExpectation: 0, netWorthTarget: 0, incomeSafetyFactor: 100,
    runwayTags: [], runwayExpectation: 0,
    snapshotReminder: { window: 'end', days: 5 }, snapshotReminderLastPrompted: null,
    lang: 'en',
    backup: { autoFreq: 'daily', lastBackup: null },
    // 压测情景（只存跌幅，不存金额）: null = 未启用。为什么不落盘金额见 DECISIONS.md
    stress: null,
    // 上一次被清掉的压测情景：压测条上的「回到上一次」读它（清除因此不必再弹确认）
    stressLast: null,
  };
}
let state = freshAppState();
let chart = null;
let historyChart = null;
let historyChartMode = 'value';
// 堆叠柱下钻与图例记忆（历史净值）：
// histLegendSel 由原生 legendselectchanged 维护，重绘时经 chartData.pruneLegendSelected 清理后回灌
//（非破坏性：原始映射不回写，切换分类再切回可恢复原选中态）；
// histDrillMeta 存当前渲染上下文，供 wireStackedBarDrill 反查「月份 × 标签」
let histLegendSel = {};
let histDrillMeta = null;
let expenseSortBy = 'date';
let expenseSortDir = 'desc';
let expenseTrendMode = 'value';
let currentMode = 'expenses';
let sortBy = '';
let sortDir = 'asc';

/* ===== 图表尺寸：唯一来源是容器的**可见尺寸** =====
   为什么不靠 window resize：
     ① 容器的尺寸还会因为**窗口以外**的原因变——实测到的是切 Tab 的 display 翻转
        （含消费/资产模式切换），而 window resize 只覆盖窗口变化这一种；
     ② resize 只挂在窗口事件上，切 Tab 造成的尺寸变化它根本看不到。
   实测（真 echarts，不是推论）：图在**隐藏**时被 resize 一次，尺寸会被压成 100px 宽，
   之后再进那个 Tab（渲染只 setOption，不 resize）也修不回来——用户看到的就是
   「全屏再缩小后图不对」。故每张图盯住自己的容器：容器尺寸一变就对齐，容器不可见
   （尺寸为 0）时不动它（拿 0 去 resize 才是把图做废的那一步）。
   这是全文件**唯一**的图表尺寸同步路径（e2e/chart-resize.spec.js 逐个图表面扫）。 */
function syncChartSize(chart) {
  if (!chart) return;
  const el = chart.getDom();
  if (!el) return;
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return; // 隐藏/未布局：等它可见
  if (chart.getWidth() !== w || chart.getHeight() !== h) chart.resize();
}
function observeChartSize(chart) {
  if (!chart) return;
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', () => syncChartSize(chart));
    return;
  }
  new ResizeObserver(() => syncChartSize(chart)).observe(chart.getDom());
}

// ========== INIT ===========
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    // 语言先落地：静态文案（data-i18n）在首帧渲染前就要换成当前语言，
    // 否则英文用户会先看见一闪而过的中文
    applyI18nDom();
    syncLangSeg();
    applyThemeChrome();
    // 捕获本次启动的汇率拉取 promise，交给 maybeAutoBackup 复用同一笔请求、
    // 等汇率更新完毕后再导出，避免备份拿到过期汇率（见 maybeAutoBackup）
    const ratePromise = fetchRates();
    renderAll();
    // 钉住下拉框的固有宽度（opt-in base-select 之后 select 不再按最长选项取宽）。
    // 字体就绪后再量一次：量宽吃真实字形度量，回退字体下量出的值会偏，宁可多量一遍。
    freezeSelectWidths();
    // 指示条初始对位（首屏 active tab）——不只靠 switchTab，直接刷新也会进这里
    moveTabIndicator('#tabs-expenses', 'expenses');
    if (typeof flatpickr !== 'undefined') {
      flatpickr('#expense-date', {
        locale: i18n.normalizeLang(state.lang) === 'zh' && flatpickr.l10ns && flatpickr.l10ns.zh ? flatpickr.l10ns.zh : 'default',
        dateFormat: 'Y-m-d',
        defaultDate: date.getLocalDateStr(),
        disableMobile: true,
        animate: true,
        weekNumbers: false,
        showMonths: 1,
        onChange: function(selectedDates, dateStr) {
          document.getElementById('expense-date').value = dateStr;
        }
      });
    }
    // 一次 rAF 再落纸：两态在同一帧翻转等于没有过渡（图表尺寸与字体就绪各自有登记点，不在此）。
    requestAnimationFrame(() => document.documentElement.classList.add('ready'));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { freezeSelectWidths(); refreshVisibleCharts(); });
    }
    checkBackupStale();
    backupDirReady = restoreBackupDir(); // 句柄从 IndexedDB 恢复；自动备份写盘前会 await
    maybeAutoBackup(ratePromise);
    syncLamp(); // 判定开关（此时还没指针坐标，灯不会亮；首枚坐标到达时再由 setLampAt 点亮）
  });

  // 从 bfcache 恢复（后退/前进、恢复标签页）时，DOMContentLoaded 不会再次触发，
  // 汇率与 masthead 总资产停留在页面被冻结时的旧值——这正是「强刷一下就好」的根因。
  // 监听 pageshow，命中 bfcache 时重新拉取汇率并重渲染。
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      fetchRates();
      renderAll();
    }
  });

  // 切回本标签页时，若汇率已过期（超过 1 小时）也刷新一次，保证「每次进入」都是新汇率。
  // 过期判断避免频繁切 tab 时重复请求 CDN。
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const fetchedAt = state.rates && state.rates.fetchedAt ? Date.parse(state.rates.fetchedAt) : 0;
      if (!fetchedAt || Date.now() - fetchedAt > 3600000) {
        fetchRates();
        renderAll();
      }
    }
  });

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    state = raw ? { ...freshAppState(), ...JSON.parse(raw) } : freshAppState();
    migrate.migrateState();
  } catch(e) {
    // 回退到完整初始状态（单一来源），避免上次半解析残留
    state = freshAppState();
    migrate.migrateState();
  }
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

// ========== RATES ==========
async function fetchRates() {
  try {
    // CDN 对 @latest 响应带 Cache-Control: max-age=604800（7 天），
    // fetch 默认复用浏览器缓存，导致普通刷新拿不到新汇率（Ctrl+Shift+R 才行）。
    // 这里强制不缓存，由外层 1 小时节流（visibilitychange/pageshow）控制请求频率。
    const resp = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json', { cache: 'no-store' });
    const data = await resp.json();
    // 形状校验与「取倒数」口径在 logic.js backup.ratesFromApi（可单测）：脏响应返回 null，
    // 走下面的 catch 回退，不得把 NaN / Infinity 写进 state 并落盘。
    const next = backup.ratesFromApi(data && data.cny);
    if (!next) throw new Error(i18n.t('汇率响应缺少有效币种'));
    state.rates = next;
    saveState();
    renderAssets();
    // 与其他操作提示统一走右下角便条；info=系统中性知会（金墨边注），不打断当前操作
    toast(i18n.t('汇率已更新'), 'info');
  } catch(e) {
    const n = backup.rateFallbackNotice(!!state.rates.fetchedAt);
    toast(n.msg, n.type);
  }
}

// ========== TABS ==========
function switchMode(mode) {
  // 已经在这个模式里：再点一次是空点击。整块重绘 + 重播入场只是把同样的东西再画一遍，
  // 而且内层 switchTab 会把子 Tab 拽回第一个（在「消费趋势」上看一眼再点「消费」会被弹回消费记录）。
  if (mode === currentMode) return;
  const prevBtn = document.querySelector('#mode-assets.active, #mode-expenses.active');
  const nextBtn = document.getElementById('mode-' + mode);
  const shift = ui.paneEnterShift(prevBtn ? prevBtn.offsetLeft : null, nextBtn ? nextBtn.offsetLeft : null);
  currentMode = mode;
  // 只切 'active'，不用 className 整体赋值：模式按钮上还挂着长按专用的 .mode-press
  document.getElementById('mode-assets').classList.toggle('active', mode === 'assets');
  document.getElementById('mode-expenses').classList.toggle('active', mode === 'expenses');

  document.getElementById('tabs-assets').style.display = mode === 'assets' ? '' : 'none';
  document.getElementById('tabs-expenses').style.display = mode === 'expenses' ? '' : 'none';
  document.getElementById('content-assets').style.display = mode === 'assets' ? '' : 'none';
  document.getElementById('content-expenses').style.display = mode === 'expenses' ? '' : 'none';
  // 注意：入场动画只挂在会动画的内层面板上（CSS 选择器 [id^="tab-"]）；content-* 只是外壳，
  // 对它调 enterTab 是一条没人消费的死接线（契约与 E2E 都断言了真实路径，别再加回来）。

  if (mode === 'assets') {
    switchTab('assets', shift);
  } else {
    switchTab('expenses', shift);
  }
}

// Tab 指示条的位置换算（单一来源）：按目标按钮的 offsetLeft/offsetWidth 实测写入 CSS 变量。
// 不能按下标 × 固定宽度估算——按钮文字长短不一，换窗口后还会变。
function moveTabIndicator(tabBarSel, tab) {
  const bar = document.querySelector(tabBarSel);
  if (!bar) return;
  const btn = bar.querySelector('.tab-btn[data-tab="' + tab + '"]');
  const ind = bar.querySelector('.tab-indicator');
  if (!btn || !ind) return;
  ind.style.setProperty('--tab-x', btn.offsetLeft + 'px');
  ind.style.setProperty('--tab-w', btn.offsetWidth + 'px');
}

// 窗口尺寸变化后按钮位置会变，指示条要重新对位（rAF 合帧：一次 resize 只算一次）
let _tabIndRaf = 0;
window.addEventListener('resize', () => {
  if (_tabIndRaf) cancelAnimationFrame(_tabIndRaf);
  _tabIndRaf = requestAnimationFrame(() => {
    _tabIndRaf = 0;
    // 当前 tab 从各自的 active 按钮读（它是唯一真相，不必再养一个状态变量——
    // 养两份必然漂移）。未激活的 Tab 栏整体 display:none，读不到 active 也无害。
    ['#tabs-assets', '#tabs-expenses'].forEach(sel => {
      const cur = document.querySelector(sel + ' .tab-btn.active');
      if (cur) moveTabIndicator(sel, cur.dataset.tab);
    });
  });
});

// 入场过渡：display 已翻开，隔一帧再加 .enter 播动画（同帧会连初始态一起画、动画不播）；方向由 --pane-x 给。
function enterTab(pane, shift) {
  if (!pane) return;
  pane.style.setProperty('--pane-x', String(shift || 0));
  pane.classList.remove('enter');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pane.classList.add('enter');
    });
  });
}

// 「等新面板布局好再渲染」的唯一入口：rAF 让出一帧，执行时再确认仍可见——不可见就不画（隐藏容器 init 出 0×0 实例）。
function afterTabPaint(tab, render) {
  requestAnimationFrame(() => {
    const pane = document.getElementById('tab-' + tab);
    if (pane && pane.style.display === 'none') return;
    render();
  });
}

// 点「当前已激活」的 Tab 是一次空点击：整块重绘 + 重播入场只是把同样的东西再画一遍
// （用户实测：「已经在消费分布这个标签下，再次点击它应该不生效，现在还会重新刷新页面」）。
// 判定就是按钮自己的 active 态——隐藏的 Tab 栏收不到点击，不必再问一遍模式。
// 9 个按钮共用这一个入口：判定各写一份必然漂移。
function tabClick(btn) {
  if (btn.classList.contains('active')) return;
  switchTab(btn.dataset.tab);
}

// 图表 Tab 实例查表：进入 Tab 时清掉旧模型用。存 getter 而不是实例本身——
// 实例是首次渲染时才创建的，且声明分散在各图区块里。
const chartByTab = {
  chart: () => chart,
  history: () => historyChart,
  income: () => incomeChart,
  'expense-chart': () => expenseChart,
  'expense-trend': () => expenseTrendChart,
};

// 进入图表 Tab 前清掉旧模型：ECharts 对**相同数据**的 setOption 只做差值更新，节点原地不动，
// 入场动画不会重播（首次 init 才有——用户实测「只有第一次进来有动画」）。
// clear() 保留实例与接线（下钻监听、ResizeObserver），只清模型；随后的 setOption 按首绘处理，
// 动画重播一遍。只在 switchTab 调用：快照保存、汇率/主题刷新等重绘不走这里，不该闪。
function clearChartForEnter(tab) {
  const get = chartByTab[tab];
  const c = get && get();
  if (c) c.clear();
}

function switchTab(tab, shift) {
  const tabBar = currentMode === 'assets' ? '#tabs-assets' : '#tabs-expenses';
  // 方向感（与模式切换共用同一份判定）：目标按钮在旧按钮右侧 = 内容自右滑入。
  // 必须在切换 active 之前读旧按钮——之后 .active 已经搬家；模式切换会透传 shift 进来
  // （一次「翻页」只有一个方向，内层不再自算一份）。
  if (shift === undefined) {
    const bar = document.querySelector(tabBar);
    const prevBtn = bar && bar.querySelector('.tab-btn.active');
    const nextBtn = bar && bar.querySelector('.tab-btn[data-tab="' + tab + '"]');
    shift = ui.paneEnterShift(prevBtn ? prevBtn.offsetLeft : null, nextBtn ? nextBtn.offsetLeft : null);
  }
  document.querySelectorAll(tabBar + ' .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  moveTabIndicator(tabBar, tab);
  ['assets', 'categories', 'chart', 'history', 'income',
    'expenses', 'expense-categories', 'expense-chart', 'expense-trend']
    .forEach(id => { document.getElementById('tab-' + id).style.display = tab === id ? '' : 'none'; });
  // 刚显示的 Tab 里的下拉框才有布局，现在才量得到固有宽度（隐藏时 clientWidth 为 0）。
  // 不能只靠 setSelectOptions 里的那一次：它“内容没变就不碰 DOM”，隐藏时填过的下拉不会重走。
  freezeSelectWidths();
  clearChartForEnter(tab); // 与 display 翻转同帧，下一帧才画，看不到清空的那一瞬
  if (tab === 'chart') {
    fillCategorySelect('chart-category-select', state.categories);
    afterTabPaint(tab, renderChart);
  }
  if (tab === 'history') {
    fillCategorySelect('history-category-select', state.categories);
    afterTabPaint(tab, renderHistoryChart);
  }
  if (tab === 'income') {
    afterTabPaint(tab, renderIncomeTab);
  }
  enterTab(document.getElementById('tab-' + tab), shift);
  if (tab === 'expense-categories') {
    renderCategoryCards('expense');
  }
  if (tab === 'expense-chart') {
    populateExpenseChartSelects();
    afterTabPaint(tab, renderExpenseChart);
  }
  if (tab === 'expense-trend') {
    fillCategorySelect('expense-trend-category-select', state.expenseCategories);
    afterTabPaint(tab, renderExpenseTrendChart);
    afterTabPaint(tab, renderHeatmap);
  }
}

// ========== 进入资产页的门槛：长按抬闸 + 抄写放行 ==========
// 两段闸：指针先按住「资产」满 ui.MODE_PRESS_MS，抬闸后抄一句随机箴言才进。这不是权限，
// 是给「看一眼」定价；价格不因设备而异：合成 click 不付长按（按住 Enter 会按键重复），但抄写同价。
let modePressStart = null;
let modePressRaf = 0;
let assetGatePhrase = ''; // 本次要抄的那一句：抬闸时抽定，抄错也**不换句**

// 已经在资产页时入口整体失效：再问一次「现在确实要看？」是荒谬的。
// 抽成函数是因为按下与进门两条路径都要这道闸，而它是「门的语义」而非权限校验
function assetsEntryOpen() {
  return currentMode !== 'assets';
}

function startModePress(e) {
  if (!assetsEntryOpen()) return;
  if (e && e.button !== 0) return; // 只认左键/触摸：右键是「想开菜单」，不是想进门
  cancelModePress(); // 上一次没收尾的按下（指针被系统夺走等）先清干净
  modePressStart = performance.now();
  const btn = document.getElementById('mode-assets');
  btn.classList.add('pressing');
  btn.style.setProperty('--mode-press', 0);
  modePressRaf = requestAnimationFrame(tickModePress);
}

function tickModePress() {
  if (modePressStart === null) return; // 已被收尾的残留帧（cancel 后仍排到的那一帧）
  const held = performance.now() - modePressStart;
  const btn = document.getElementById('mode-assets');
  btn.style.setProperty('--mode-press', ui.modePressProgress(held));
  if (ui.modePressDecision(held) !== 'enter') {
    modePressRaf = requestAnimationFrame(tickModePress);
    return;
  }
  // 满时长**直接抬闸**（不等松手）：跟着抬起的 pointerup/click 由 autoOpenGuard 守卫窗忽略
  // （旧决策躲的「手指落在遮罩上把弹窗点掉」已由守卫窗解决，不必再等松手）。
  modePressRaf = 0;
  modePressStart = null;
  btn.classList.remove('pressing');
  btn.style.removeProperty('--mode-press');
  __autoOpenedAt = performance.now();
  openAssetGate();
}

// 自动弹出后一小段时间内的指针事件全部忽略（抬起的手指紧跟一次 pointerup/click，
// 不忽略的话会把刚出现的确认框当场点掉）。窗口判据在 logic.js ui.autoOpenGuard。
let __autoOpenedAt = null;

// 松手收尾：短按只教一句（按满的情形已在 tick 里弹掉，不会走到这里）。
function endModePress(e) {
  if (modePressStart === null) return; // 没有进行中的按下（在页面别处松手），不响应
  if (e && e.button !== 0) return;     // 右键松开不该替左键的按住收尾
  // 自动弹出后紧跟的松手：守卫窗内一律忽略（不是用户的「第二次操作」）
  if (__autoOpenedAt !== null && !ui.autoOpenGuard(performance.now() - __autoOpenedAt)) return;
  const decision = ui.modePressDecision(performance.now() - modePressStart);
  resetModePress();
  if (decision === 'enter') openAssetGate();
  else if (decision === 'hint') toast(ui.modePressHint(), 'info');
}

// click 的处置：键盘 Enter/Space、读屏器与程序化激活都不带指针按压过程，detail 为 0
//（浏览器就是这样标注「不是人手点出来的」，鼠标/触摸是 1，E2E 已验证）。它们**只抬闸、
// 不进门**：长按挡的是顺手一点，这条路一样要抄一句——曾经的「合成 click 直达」是廉价通道。
function modePressClick(e) {
  if (e.detail === 0) openAssetGate();
}

// 指针移开/被系统夺走：放弃本次按下，既不提示也不进门
function cancelModePress() {
  if (modePressStart === null) return;
  resetModePress();
}

// 用 null（而非 0）标记「没有进行中的按下」：performance.now() 在小数上是合法值，
// 拿 0 当哨兵会让「页面刚打开就按下」那次被当成没按过（门的语义不该取决于时间原点）
function resetModePress() {
  if (modePressRaf) cancelAnimationFrame(modePressRaf);
  modePressRaf = 0;
  modePressStart = null;
  const btn = document.getElementById('mode-assets');
  btn.classList.remove('pressing');
  // 移除而不是置 0：置 0 会在元素上永远留一条内联样式（CSS 默认值本来就是 0）
  btn.style.removeProperty('--mode-press');
}

// 收尾挂在 document 上而非按钮上：在按钮外松手时 pointerup 不会落到按钮上，
// 挂在按钮上会漏收尾——墨线留在满格、下一次按下直接被误判成就绪
document.addEventListener('pointerup', endModePress);
document.addEventListener('pointercancel', cancelModePress);

// 抬闸：抽一句箴言、清空输入、打开抄写框。已在资产页时不弹（入口整体失效）。
function openAssetGate() {
  if (!assetsEntryOpen()) return;
  assetGatePhrase = ui.entryPhrase(state.lang);
  document.getElementById('asset-gate-phrase').textContent = assetGatePhrase;
  document.getElementById('asset-gate-input').value = '';
  setAssetGateError(false);
  openModal('asset-gate-modal');
}

function setAssetGateError(on) {
  document.getElementById('asset-gate-error').style.display = on ? '' : 'none';
}

// 输入框键位：Enter 提交（输入法组合中的 Enter 是「选词」，不提交）；不在输入时校验。
function assetGateKey(e) {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitAssetGate(); }
}

// 提交即判：抄对就进门（不再要第二次点击，那只会教人连点）；抄错原地重试——原句不换、输入清空。
function submitAssetGate() {
  if (__autoOpenedAt !== null && !ui.autoOpenGuard(performance.now() - __autoOpenedAt)) return;
  if (!assetsEntryOpen()) { cancelAssetGate(); return; }
  const input = document.getElementById('asset-gate-input');
  if (!ui.entryPhraseMatches(input.value, assetGatePhrase)) {
    input.value = '';
    setAssetGateError(true);
    input.focus();
    return;
  }
  cancelAssetGate();
  switchMode('assets');
}

// 放弃（Esc / 点遮罩 / 「不看」）：本次作废，下次从长按重新开始
function cancelAssetGate() {
  assetGatePhrase = '';
  setAssetGateError(false);
  closeModal('asset-gate-modal');
}

// ========== 台灯掠光（全站唯一的常驻动效）==========
// 判定与换算在 logic.js（ui.lampPos / ui.lampEnabled）；这里只取信号、写变量、收事件。
const _reduceMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
// 粗指针 = 触屏（没有悬停可言），不跟：省掉一幅全屏固定层的逐帧重绘
const _coarsePointer = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
let _reduceMotion = _reduceMotionQuery ? _reduceMotionQuery.matches : false;
let _lampPending = null; // 待写的指针坐标（同一帧内多次 move 只写最后一枚）
let _lampLast = null;    // 最后一枚已收到的坐标（resize 重算用）
let _lampRaf = 0;

// 灯该不该亮：三种「不跟」的情况（减动效/触屏/页面不可见），
// 外加**还没收到过指针坐标就不亮** —— 灯是「跟指针」的，首帧在正中央先亮起一团光
// 再跳到指针处，那不像一盏灯，像是没加载完。
function syncLamp() {
  const layer = document.querySelector('.lamp-layer');
  if (!layer) return;
  const on = ui.lampEnabled({
    reducedMotion: _reduceMotion,
    coarsePointer: _coarsePointer,
    hidden: document.hidden,
    modalOpen: openModalStack().length > 0,
  }) && _lampLast !== null;
  layer.classList.toggle('on', on);
}

// 指针坐标 → CSS 变量。每帧只写一次（rAF 合并）——
// pointermove 在 120Hz 屏上每秒百次，逐次写变量会让固定层的渐变重算成为主要开销。
// 坐标先归一成 {x, y} 再排帧：resize 重算要复用同一入口，
// 而那里手上是一对坐标、不是事件对象（曾经直接回传旧对象，于是 resize 后灯再也不重算）
function setLampAt(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  _lampLast = { x: x, y: y };
  _lampPending = _lampLast;
  syncLamp(); // 首枚坐标到达 = 可以亮灯了
  if (_lampRaf) return;
  _lampRaf = requestAnimationFrame(flushLamp);
}

function updateLamp(e) {
  if (!e) return;
  setLampAt(e.clientX, e.clientY);
}

function flushLamp() {
  _lampRaf = 0;
  const p = _lampPending;
  _lampPending = null;
  if (!p) return;
  const layer = document.querySelector('.lamp-layer');
  if (!layer || !layer.classList.contains('on')) return;
  const pos = ui.lampPos(p.x, p.y, window.innerWidth, window.innerHeight);
  layer.style.setProperty('--lamp-x', pos.x + '%');
  layer.style.setProperty('--lamp-y', pos.y + '%');
}

// resize 后旧百分比对应的是新尺寸上的另一个位置（灯会偏离指针），依最后一枚坐标重算
window.addEventListener('resize', () => { if (_lampLast) setLampAt(_lampLast.x, _lampLast.y); });
document.addEventListener('pointermove', updateLamp);
document.addEventListener('visibilitychange', syncLamp);
if (_reduceMotionQuery && _reduceMotionQuery.addEventListener) {
  _reduceMotionQuery.addEventListener('change', (ev) => { _reduceMotion = ev.matches; syncLamp(); });
}

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
        <div class="flex flex-wrap gap-1">${tagHtml}</div>
        <div class="flex gap-2 justify-end">
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
        <div class="flex items-center justify-between t-micro mb-1.5 muted">
          <span>${i18n.t('目标净资产 · ')}<span class="tabular text-value">${pct.toFixed(0)}%</span></span>
          <span class="flex items-center gap-2">
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

// ========== CATEGORY CRUD ==========
// 六个操作各一个入口：侧别由调用现场给（静态控件读 data-side，卡片模板在生成期拼字面量）。
// 入口名不再按侧别分叉——此前是 12 个一行转发 + editCategory → openCategoryModal → *Generic
// 三级跳，改一个名字要动配置表与两个函数。

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
    down: v('--down') || '#a84943',
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

function cmpBar(d, maxAbs, colorFn) {
  if (d === 0) return '';
  return `<div class="cmp-bar-track"><div class="cmp-bar" style="width:${Math.max(3, Math.abs(d) / maxAbs * 100).toFixed(1)}%;background:${colorFn(d)};"></div></div>`;
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
  const firstField = list.find(el => el.matches('input, select, textarea') && isAutoFocusable(el));
  const target = firstField || list.find(isAutoFocusable) || list[0];
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

// ========== 分类管理（资产 / 消费共用）==========
// 两套分类的 CRUD 仅数据集合与文案不同，逻辑完全一致，统一到 CAT_SIDES 配置 + 通用函数。
const CAT_SIDES = {
  asset: {
    cats: () => state.categories,
    items: () => state.assets,
    renderItems: renderAssets,
    newTagPrefix: 'new-tag-',
    colorFn: catColor,
    listId: 'categories-list',
    // 配置对象在脚本加载时求值：文案一律存成**取值函数**，调用时才取词。
    // 直接写 i18n.t(...) 会冻结成加载那一刻的语言（默认英文下切中文，这些文案仍是英文）。
    noun: () => i18n.t('资产'),
    savedUpdated: () => i18n.t('分类已更新'), savedCreated: () => i18n.t('分类已创建'),
    // 数据校验：两侧都接线。新增分类后老资产会缺该分类标签（分布/收益少算），列表上看不出来；
    // 历史快照是历史事实（快照深拷贝了当时的资产），**不随补齐回填**，面板顶部说明这一点。
    tagCheck: true,
    tagCheckBar: 'tagcheck-bar-assets',
    tagCheckHint: () => i18n.t('下面这些资产在某个分类下还没有标签（新增分类后老资产会缺）。组内顶部可一键补齐，也可以在每条资产上逐个点选，点一下即保存。历史快照按当时数据保留，不随补齐更新。'),
    tagCheckMeta: assetTagCheckMeta,
    modal: { id: 'category-modal', title: 'category-modal-title', form: 'category-form', editId: 'cat-edit-id', name: 'cat-name', tags: 'cat-tags', editTitle: () => i18n.t('编辑分类'), newTitle: () => i18n.t('新增分类') },
  },
  expense: {
    cats: () => state.expenseCategories,
    items: () => state.expenses,
    renderItems: renderExpenses,
    newTagPrefix: 'expense-new-tag-',
    colorFn: expenseCatColor,
    listId: 'expense-categories-list',
    noun: () => i18n.t('消费记录'),
    savedUpdated: () => i18n.t('消费分类已更新'), savedCreated: () => i18n.t('消费分类已创建'),
    tagCheck: true,
    tagCheckBar: 'tagcheck-bar-expense',
    tagCheckHint: () => i18n.t('下面这些记录在某个分类下还没有标签。组内顶部可一键补齐，也可以在每条记录上逐个点选，点一下即保存。'),
    tagCheckMeta: expenseTagCheckMeta,
    modal: { id: 'expense-category-modal', title: 'expense-category-modal-title', form: 'expense-category-form', editId: 'expense-cat-edit-id', name: 'expense-cat-name', tags: 'expense-cat-tags', editTitle: () => i18n.t('编辑消费分类'), newTitle: () => i18n.t('新增消费分类') },
  },
};

// 长按改名的唯一接线处（事件委托）：分类卡片每次重绘都换掉内层 DOM，
// 逐个挂监听会在每次重绘后留下悬挂闭包（旧胶囊被换掉，监听仍指着它）。
// 两个分类列表共用这一套（资产/消费）。
['categories-list', 'expense-categories-list'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('pointerdown', e => {
    const pill = e.target.closest && e.target.closest('.tag-pill[data-rename]');
    if (pill) startTagPress(e, pill);
  });
});

function renderCategoryCards(side) {
  const cfg = CAT_SIDES[side];
  const container = document.getElementById(cfg.listId);
  const gaps = cfg.tagCheck ? expense.missingTagGroups(cfg.items(), cfg.cats()) : [];
  const gapOf = id => gaps.find(g => g.catId === id);
  container.innerHTML = cfg.cats().map(cat => {
    // 内置分类（货币类型）是写死的逻辑：标签就是币种代码，改名与删除在守卫里都只回一句
    // 「内置分类不可修改」。故整张卡片**只读**——不接改名与删除入口，否则长按弹出输入框、
    // 提交又被守卫拒绝（拒绝路径只是 return，没人收走那个输入框），用户实测的
    //「长按内置的货币类型，然后点其他地方不能取消编辑」就是这么来的。
    const tagOpts = cat.builtin
      ? { showKey: false }
      : { showKey: false, removeSide: side, renameSide: side };
    const tagPills = cat.tags.map(t => tagPillHtml(cat, t, cfg.colorFn, tagOpts)).join(' ');
    // 「添加」按钮与回车共用同一调用表达式, 防两处接线各自漂移
    const addTagCall = `addTag('${text.jsAttr(side)}', '${text.jsAttr(cat.id)}')`;
    const gap = gapOf(cat.id);
    return `<div class="card">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <h3 class="card-title">${text.esc(cat.name)}</h3>
          ${cat.builtin ? '<span class="t-micro px-2 py-0.5 rounded muted" style="background:var(--bg-2);border:1px solid var(--border);">' + i18n.t('内置') + '</span>' : ''}
        </div>
        <div class="flex gap-2">
          ${!cat.builtin ? `<button onclick="openCategoryModal('${text.jsAttr(side)}', '${text.jsAttr(cat.id)}')" class="row-btn edit">${i18n.t('编辑')}</button>
          <button onclick="deleteCategory('${text.jsAttr(side)}', '${text.jsAttr(cat.id)}')" class="row-btn danger">${i18n.t('删除')}</button>` : ''}
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mb-3">${tagPills}</div>
      ${cat.builtin ? '' : `
      <div class="new-tag-row">
        <input type="text" id="${text.esc(cfg.newTagPrefix + cat.id)}" placeholder="${i18n.t('新增标签（回车添加）')}" class="t-body" autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();${addTagCall};}">
        <button onclick="${addTagCall}" class="btn-ghost btn-sm">${i18n.t('添加')}</button>
      </div>`}
      ${gap ? `<div class="tagcheck-strip">
        <span class="t-micro"><b class="ink-accent">${gap.items.length}</b> ${i18n.t('条记录未归到本分类')}</span>
        <button type="button" class="row-btn edit" onclick="openTagCheck('${text.jsAttr(side)}', '${text.jsAttr(cat.id)}')">${i18n.t('去校验')}</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function openCategoryModal(side, editId) {
  const m = CAT_SIDES[side].modal;
  const modal = document.getElementById(m.id);
  const title = document.getElementById(m.title);
  const form = document.getElementById(m.form);
  form.reset();
  document.getElementById(m.editId).value = editId || '';
  if (editId) {
    title.textContent = m.editTitle();
    const c = CAT_SIDES[side].cats().find(x => x.id === editId);
    if (c) {
      document.getElementById(m.name).value = c.name;
      document.getElementById(m.tags).value = c.tags.join(', ');
    }
  } else {
    title.textContent = m.newTitle();
  }
  openModal(m.id);
}

function saveCategory(side, e) {
  e.preventDefault();
  const cfg = CAT_SIDES[side];
  const m = cfg.modal;
  const editId = document.getElementById(m.editId).value;
  const name = document.getElementById(m.name).value.trim();
  const tagsStr = document.getElementById(m.tags).value.trim();
  const tags = category.parseTagInput(tagsStr);

  if (tags.length === 0) {
    toast(i18n.t('至少需要一个标签'), 'error');
    return;
  }

  const cats = cfg.cats();
  const idx = editId ? cats.findIndex(c => c.id === editId) : -1;
  // 确认前一律不改内存态：取消保存后内存必须与存档一致（否则后续任一 saveState 会把它悄悄落盘）
  const removed = idx >= 0 ? (cats[idx].tags || []).filter(t => !tags.includes(t)) : [];
  let createdId = '';

  // 保存动作：直接保存与「确认清空引用」后共用同一段，避免两条保存路径各自漂移
  const apply = () => {
    if (idx >= 0) {
      cats[idx] = { ...cats[idx], name, tags };
    } else {
      const created = { id: genId(), name, builtin: false, tags };
      cats.push(created);
      createdId = created.id;
    }
    cfg.items().forEach(it => {
      if (it.tags[editId] && !tags.includes(it.tags[editId])) delete it.tags[editId];
    });
    // 分类标签被移除后同步清理读数行引用（消费分类与读数行无关，带侧别闸门）
    if (side === 'asset') state.runwayTags = income.pruneRunwayTags(state.runwayTags, state.categories);
    saveState();
    renderCategoryCards(side);
    cfg.renderItems();
    closeModal(m.id);
    toast(editId ? cfg.savedUpdated() : cfg.savedCreated(), 'success');
    if (createdId && cfg.tagCheck) {
      const gap = expense.missingTagGroups(cfg.items(), cfg.cats()).find(g => g.catId === createdId);
      if (gap) openTagCheck(side, createdId);
    }
  };

  // 被移除的标签若仍被引用，先告知将清空多少条记录（静默清空归类会让分布/收益默默失真）
  const refs = expense.countTagRefs(cfg.items(), editId, removed);
  if (refs > 0) {
    showConfirm(
      i18n.t('「{p1}」已不在标签列表中，保存后将清空 {p2} 条记录上的归类。', { p1: removed.join('、'), p2: refs }) +
      i18n.t('只想改名的话，长按那枚标签即可（会保留归类）。'),
      apply,
      i18n.t('移除标签')
    );
    return;
  }
  apply();
}

function deleteCategory(side, id) {
  const cfg = CAT_SIDES[side];
  const cat = cfg.cats().find(c => c.id === id);
  if (cat && cat.builtin) return;
  showConfirm(i18n.t('确认删除分类「{p1}」？该分类下{p2}的标签关联也会被移除。', { p1: cat.name, p2: cfg.noun() }), () => {
    const newCats = cfg.cats().filter(c => c.id !== id);
    if (side === 'asset') state.categories = newCats; else state.expenseCategories = newCats;
    cfg.items().forEach(it => { delete it.tags[id]; });
    if (side === 'asset') state.runwayTags = income.pruneRunwayTags(state.runwayTags, state.categories);
    // 压测情景指向的分类没了 → 整条作废（normalizeRunwayTags 同理：不留指向已删分类的跌幅）
    if (side === 'asset') state.stress = stress.pruneStress(state.stress, state.categories);
    saveState();
    renderCategoryCards(side);
    cfg.renderItems();
    toast(i18n.t('分类已删除'), 'success');
  });
}

function addTag(side, catId) {
  const cfg = CAT_SIDES[side];
  const input = document.getElementById(cfg.newTagPrefix + catId);
  const val = input.value.trim();
  if (!val) return;
  const cat = cfg.cats().find(c => c.id === catId);
  if (!cat) return;
  if (cat.builtin) { toast(i18n.t('内置分类不可修改'), 'error'); return; }
  if (cat.tags.includes(val)) { toast(i18n.t('标签已存在'), 'error'); return; }
  cat.tags.push(val);
  saveState();
  renderCategoryCards(side);
  cfg.renderItems();
  const next = document.getElementById(cfg.newTagPrefix + catId);
  if (next) next.focus();
  toast(i18n.t('标签已添加'), 'success');
}

function removeTag(side, catId, tagName) {
  const cfg = CAT_SIDES[side];
  const cat = cfg.cats().find(c => c.id === catId);
  if (!cat) return;
  if (cat.builtin) { toast(i18n.t('内置分类不可修改'), 'error'); return; }
  if (cat.tags.length <= 1) { toast(i18n.t('至少保留一个标签'), 'error'); return; }
  const refs = expense.countTagRefs(cfg.items(), catId, [tagName]);
  showConfirm(i18n.t('确认移除标签「{p1}」？{p2} 条记录上的归类也会被清空。', { p1: tagName, p2: refs }), () => {
    cat.tags = cat.tags.filter(t => t !== tagName);
    cfg.items().forEach(it => { if (it.tags[catId] === tagName) delete it.tags[catId]; });
    if (side === 'asset') state.runwayTags = income.pruneRunwayTags(state.runwayTags, state.categories);
    saveState();
    renderCategoryCards(side);
    cfg.renderItems();
    toast(i18n.t('标签已移除'), 'success');
  });
}

// 标签改名（长按胶囊）：**迁移引用**而不是删除重建——旧名若走「已失效引用」清理，
// 资产/消费上的归类会被静默清空（分布/收益随之失真）。本函数只管数据与重绘，
// 输入框由 startTagRename 就地提供。
function renameTag(side, catId, oldName, newName) {
  const cfg = CAT_SIDES[side];
  const cat = cfg.cats().find(c => c.id === catId);
  if (!cat) return;
  if (cat.builtin) { toast(i18n.t('内置分类不可修改'), 'error'); return; }
  // 空名 / 同名 / 重名都不改数据，重绘即把输入框还原成原来的胶囊
  if (!newName || newName === oldName) { renderCategoryCards(side); return; }
  if (cat.tags.includes(newName)) { toast(i18n.t('标签已存在'), 'error'); renderCategoryCards(side); return; }
  // 旧名已不在列表里（卡片是上一次渲染的快照）：不改数据，重绘即还原
  const at = cat.tags.indexOf(oldName);
  if (at < 0) { renderCategoryCards(side); return; }
  cat.tags[at] = newName;
  expense.migrateTagRefs(cfg.items(), catId, oldName, newName);
  // 读数卡所选标签同按「分类 + 名字」引用，改名要一并迁移，否则 prune 会把选择清掉
  if (side === 'asset') state.runwayTags = income.migrateRunwayTagRefs(state.runwayTags, catId, oldName, newName);
  // 压测情景同按「分类 + 名字」引用跌幅条目，改名也要一并迁移（否则设好的情景会静默失效）
  if (side === 'asset') state.stress = stress.migrateStressTagRefs(state.stress, catId, oldName, newName);
  saveState();
  renderCategoryCards(side);
  cfg.renderItems();
  toast(i18n.t('标签已重命名'), 'success');
}

// ===== 长按胶囊改标签名 =====
// 短按什么都不做；指针移开或被系统夺走 = 放弃；长按是手势不是权限（Enter 直达）。判定与资产入口同源。
let tagPress = null; // { el, start, raf, moved }

function startTagPress(e, pill) {
  if (!pill) return;
  if (e.button !== undefined && e.button !== 0) return; // 只认左键/触摸
  // 点在 ✕ 上不是长按（那是删除按钮自己的事）
  if (e.target && e.target.closest && e.target.closest('.pill-del')) return;
  cancelTagPress();
  tagPress = { el: pill, start: performance.now(), raf: 0, moved: false };
  pill.classList.add('pressing');
  // 指针一移开就放弃：长按的对象必须始终是同一枚胶囊
  const onMove = (ev) => {
    if (!tagPress) return;
    const r = pill.getBoundingClientRect();
    if (ev.clientX < r.left - 4 || ev.clientX > r.right + 4 || ev.clientY < r.top - 4 || ev.clientY > r.bottom + 4) cancelTagPress();
  };
  const onUp = (ev) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    endTagPress(ev, pill);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  const tick = () => {
    if (!tagPress || tagPress.el !== pill) return;
    const held = performance.now() - tagPress.start;
    const progress = ui.pressProgress(held, ui.TAG_PRESS_MS);
    pill.style.boxShadow = `inset ${Math.round(progress * pill.offsetWidth)}px 0 0 0 rgba(180, 132, 26, 0.22), inset 0 -2px 0 0 var(--accent)`;
    if (ui.pressDecision(held, ui.TAG_PRESS_MS) !== 'done') { tagPress.raf = requestAnimationFrame(tick); return; }
    // 满时长**直接进编辑态**（不再等松手）：墨线涨满的那一瞬输入框就在原地出现——与
    // 「进资产页」按满即弹同一处置（旧实现让用户「按满—松手」两步，松手前墨线停在满格像卡住）。
    // 先收尾再开输入框：不先收尾的话，紧跟着的松手会让 endTagPress 再开一次（同一次长按两个入口）。
    const side = pill.dataset.rename;
    const catId = pill.dataset.cat;
    const tagName = pill.dataset.tag;
    tagPress.raf = 0;
    resetTagPress();
    if (side) startTagRename(pill, side, catId, tagName);
  };
  tagPress.raf = requestAnimationFrame(tick);
}

// 松手收尾：短按什么都不做（胶囊上的点击本来没有语义）。
// 满时长一般已在 tick 里进了编辑态、走不到这里；只有「松手早于下一帧」那一线会落到本函数——
// 那时判定同源，仍然进编辑态（手势够长了，不该因为少一帧而作废）。
function endTagPress(e, pill) {
  if (!tagPress || tagPress.el !== pill) return;
  const decision = ui.pressDecision(performance.now() - tagPress.start, ui.TAG_PRESS_MS);
  const side = pill.dataset.rename;
  const catId = pill.dataset.cat;
  const tagName = pill.dataset.tag;
  resetTagPress();
  if (decision !== 'done') return;
  if (!side) return;
  startTagRename(pill, side, catId, tagName);
}

function cancelTagPress() {
  if (!tagPress) return;
  resetTagPress();
}

function resetTagPress() {
  if (!tagPress) return;
  if (tagPress.raf) cancelAnimationFrame(tagPress.raf);
  const el = tagPress.el;
  if (el) {
    el.classList.remove('pressing');
    el.style.removeProperty('box-shadow');
  }
  tagPress = null;
}

// 键盘通道：长按是手势，键盘用户不该被挡在门外（与「进资产页」的长按门槛同一原则）
function renameTagFromKey(e) {
  e.preventDefault();
  const pill = e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest('.tag-pill') : null;
  if (!pill || !pill.dataset.rename) return;
  startTagRename(pill, pill.dataset.rename, pill.dataset.cat, pill.dataset.tag);
}

// 标签就地重命名：把整枚 pill 换成输入框（回车/blur 提交、Esc 取消），与「新增标签」同一交互语言。
// 中文输入法确认候选字用的也是回车，无 isComposing 守卫会在组字中途提前提交。
function startTagRename(pill, side, catId, oldName) {
  if (!pill || !pill.classList || !pill.classList.contains('tag-pill')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-rename-input';
  input.value = oldName;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', i18n.t('标签名称'));
  pill.replaceWith(input);
  let done = false; // Esc 取消会因重绘移除输入框而触发 blur，标记防二次提交
  const finish = (submit) => {
    if (done) return;
    done = true;
    if (submit) renameTag(side, catId, oldName, input.value.trim());
    else renderCategoryCards(side);
    // 编辑框必须有归宿：renameTag 的每条拒绝路径（分类已删 / 内置 / 重名 / 旧名过期）
    // 都只是 return，谁也没把胶囊放回去——输入框就孤零零留在卡片上，用户点别处也收不掉它。
    // 收尾放在 finish 里而不是各条守卫里：一处兜住，日后再加一条早退也不会重新漏。
    if (input.isConnected) renderCategoryCards(side);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
  });
  input.addEventListener('blur', () => finish(true));
  input.focus();
  input.select();
}

function compareBy(a, b, field, dir, getVal, secondary) {
  let va = getVal ? getVal(a, field) : a[field];
  let vb = getVal ? getVal(b, field) : b[field];
  if (typeof va === 'string') va = va.toLowerCase();
  if (typeof vb === 'string') vb = vb.toLowerCase();
  if (va < vb) return dir === 'asc' ? -1 : 1;
  if (va > vb) return dir === 'asc' ? 1 : -1;
  if (secondary) return secondary(a, b);
  return 0;
}

function updateSortIndicators(prefix, fields, sortBy, sortDir) {
  fields.forEach(f => {
    const el = document.getElementById(prefix + f);
    if (!el) return;
    el.textContent = sortBy === f ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    el.className = 'sort-indicator' + (sortBy === f ? ' active' : '');
    // aria-sort 在 role=button 上不可达（AX 树里不产生 sort 信息），真正到达读屏器的是 aria-label；
    // 每次都要 setAttribute——只设选中的话，换列后旧方向会粘在上一列上。
    const head = el.parentElement;
    if (head && head.getAttribute('role') === 'button') {
      head.setAttribute('aria-sort', ui.sortAriaSort(sortBy, sortDir, f));
      const label = (head.dataset.colLabel || head.textContent.replace(/[▲▼]/g, '').trim());
      head.dataset.colLabel = label; // 缓存可见列名：textContent 会被 ▲/▼ 污染，先剥一次再记住
      head.setAttribute('aria-label', ui.sortAriaLabel(label, sortBy, sortDir, f));
    }
  });
}

// 下拉选项统一写入：内容没变就不碰 DOM（搜索每按一键都重跑筛选链，替换 option 会打断展开中的下拉）。
function setSelectOptions(sel, html) {
  if (sel.dataset.optionsHtml === html) return;
  sel.innerHTML = html;
  sel.dataset.optionsHtml = html;
  freezeSelectWidth(sel);
}

// 钉住下拉的固有宽度：base-select 不再按最长选项取宽，换选项时宽度会跳，只能量一次写进 --sel-w。
// 量本必须带 data-measuring（否则量到的是被钉过的宽度）；拿不到布局就跳过，进 Tab 时 setSelectOptions 再量。
function freezeSelectWidth(sel) {
  if (!sel || !sel.options) return;
  const labels = [...sel.options].map((o) => o.textContent);
  if (!ui.shouldPinSelectWidth(labels)) {
    sel.style.removeProperty('--sel-w');
    return;
  }
  if (!sel.offsetParent && !sel.getClientRects().length) return;
  const probe = sel.cloneNode(true);
  probe.removeAttribute('id');
  probe.setAttribute('data-measuring', '');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden; pointer-events:none';
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  if (w > 0) sel.style.setProperty('--sel-w', w + 'px');
}

// 一次量完全部下拉：字体就绪后跑一次（量宽依赖真实字形度量，用回退字体量出的宽会偏）
function freezeSelectWidths() {
  document.querySelectorAll('body select').forEach(freezeSelectWidth);
}
function fillMonthSelect(selId, months) {
  const sel = document.getElementById(selId);
  if (!sel) return sel;
  const current = sel.value;
  setSelectOptions(sel, '<option value="">' + i18n.t('全部时间') + '</option>' +
    date.monthsDesc(months).map(m => `<option value="${m}">${date.monthLabel(m)}</option>`).join(''));
  if (current && sel.querySelector(`option[value="${current}"]`)) sel.value = current;
  return sel;
}

// 切换一对分段按钮的 active 态并执行回调(图表模式/收益口径等共用)
function setSegMode(idA, idB, mode, activeA, activeB, onChange) {
  document.getElementById(idA).className = mode === activeA ? 'seg-btn active' : 'seg-btn';
  document.getElementById(idB).className = mode === activeB ? 'seg-btn active' : 'seg-btn';
  onChange();
}

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
      <div class="flex items-center gap-2">
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
  const diffLine = '<span style="color:' + diffColor + ';">' + i18n.t('较上月 ') + sign + money.formatCNY(m.diff) + '</span>';
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
    return `<div class="card card-interactive flex items-center justify-between">
      <div class="flex-1 row-hit" role="button" tabindex="0" onclick="viewSnapshot('${text.jsAttr(s.month)}')"
        onkeydown="if(ui.activateKeyAction(event.key)){event.preventDefault();viewSnapshot('${text.jsAttr(s.month)}');}">
        <div class="flex items-center gap-2">
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

// ========== 记账热力图 + 漏记条 ==========
function renderHeatmap() {
  const grid = document.getElementById('hm-grid');
  const months = document.getElementById('hm-months');
  if (!grid || !months) return;
  const view = heatmap.weeks(state.expenses, date.getLocalDateStr());
  months.innerHTML = heatmap.monthsHtml(view);
  grid.innerHTML = heatmap.gridHtml(view);
}

function recordOnDay(dateStr) {
  openExpenseModal(null, null, dateStr);
}

function renderHeatmapNotice() {
  const bar = document.getElementById('heatmap-notice');
  if (!bar) return;
  const reading = heatmap.missingDays(state.expenses, date.getLocalDateStr());
  bar.style.display = reading.missing > 0 ? '' : 'none';
  if (reading.missing > 0) {
    bar.querySelector('.tagcheck-text').textContent = i18n.t('本月 {n} 天没有任何记录', { n: reading.missing });
  }
}

function gotoHeatmap() {
  switchTab('expense-trend');
  requestAnimationFrame(() => {
    const grid = document.getElementById('hm-grid');
    if (grid) grid.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
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
  fill.style.background = reading.over ? 'var(--down)' : (reading.pctOfMonth >= 90 ? 'var(--accent)' : 'var(--verdigris)');
  document.getElementById('pace-num').textContent = money.formatCNY(spent);
  document.getElementById('pace-expense').textContent = money.formatCNY(expectation);
  const pct = document.getElementById('pace-pct');
  // 百分比读数取 reading.pctOfMonth（与尺子宽度、≥90% 判断同源）, 不用 spent/expectation 另算一遍
  pct.textContent = money.pctStr(reading.pctOfMonth, 100) + '%';
  pct.style.color = reading.over ? 'var(--down)' : 'var(--accent-ink)';
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

// ========== DRAG REORDER ==========
let dragSrcId = null;

function onAssetDragStart(e) {
  const row = e.target.closest('.asset-row');
  dragSrcId = row?.dataset.id;
  if (!dragSrcId) return;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcId);
}

function onAssetDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.asset-row');
  if (!row || !row.dataset.id || row.dataset.id === dragSrcId) return;
  document.querySelectorAll('#assets-rows .asset-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  row.classList.add('drag-over');
}

function onAssetDragEnd(e) {
  document.querySelectorAll('#assets-rows .asset-row').forEach(r => r.classList.remove('dragging', 'drag-over'));
  dragSrcId = null;
}

function onAssetDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const targetRow = e.target.closest('.asset-row');
  if (!targetRow || !dragSrcId || !targetRow.dataset.id || targetRow.dataset.id === dragSrcId) return;
  const srcIdx = state.assets.findIndex(a => a.id === dragSrcId);
  const tgtIdx = state.assets.findIndex(a => a.id === targetRow.dataset.id);
  if (srcIdx === -1 || tgtIdx === -1) return;
  const [moved] = state.assets.splice(srcIdx, 1);
  state.assets.splice(tgtIdx, 0, moved);
  sortBy = '';
  sortDir = 'asc';
  saveState();
  renderAssets();
}

// 键盘移动资产顺序：拖拽 drop 的键盘等价物。数组操作走 logic.js ui.moveAssetIndex（可单测），
// 收尾（清排序状态 → 落盘 → 重绘）与 onAssetDrop 完全同一套——两处各写一份必然漂移。
function moveAsset(id, dir) {
  const idx = state.assets.findIndex(a => a.id === id);
  if (idx === -1) return;
  const to = idx + dir;
  const next = ui.moveAssetIndex(state.assets, idx, to);
  if (next === state.assets) return; // 越界（已到顶/底）：不动
  state.assets = next;
  sortBy = '';
  sortDir = 'asc';
  saveState();
  renderAssets();
  const fresh = document.querySelector('#assets-rows .asset-row[data-id="' + CSS.escape(id) + '"] .drag-handle');
  if (fresh) fresh.focus();
}

// ========== SORT ==========
function toggleSort(field) {
  const r = ui.nextSortState(sortBy, sortDir, field, false);
  sortBy = r.by;
  sortDir = r.dir;
  renderAssets();
}

// ========== LANGUAGE (界面语言，唯一入口：设置弹窗「语言」) ==========
// 两条通道（data-i18n / i18n.t），键即中文原文，漏译回落中文——覆盖率由 ui-wiring 逐条把守。
const I18N_ATTRS = ['aria-label', 'placeholder', 'title', 'content'];

function applyI18nDom() {
  document.documentElement.lang = i18n.langTag(state.lang);
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const next = i18n.t(el.getAttribute('data-i18n'));
    if (el.textContent !== next) el.textContent = next;
  });
  I18N_ATTRS.forEach(attr => {
    document.querySelectorAll('[data-i18n-' + attr + ']').forEach(el => {
      el.setAttribute(attr, i18n.t(el.getAttribute('data-i18n-' + attr)));
    });
  });
}

function syncLangSeg() {
  const lang = i18n.normalizeLang(state.lang);
  ['en', 'zh'].forEach(l => {
    const btn = document.getElementById('lang-seg-' + l);
    if (!btn) return;
    btn.classList.toggle('active', l === lang);
    btn.setAttribute('aria-pressed', String(l === lang));
  });
}

function syncFlatpickrLocale() {
  const el = document.getElementById('expense-date');
  const fp = el && el._flatpickr;
  if (!fp || typeof flatpickr === 'undefined') return;
  const zh = flatpickr.l10ns && flatpickr.l10ns.zh;
  fp.set('locale', i18n.normalizeLang(state.lang) === 'zh' && zh ? zh : 'default');
}

// 语言切换与主题同一套「先落盘、后重绘」路径。
// 用户数据（分类名/标签/备注）不翻译：它们不是界面文案，换语言不该改写账本内容。
function setLang(lang) {
  const next = i18n.normalizeLang(lang);
  if (next === i18n.normalizeLang(state.lang)) return;
  state.lang = next;
  saveState();
  applyI18nDom();
  syncLangSeg();
  syncFlatpickrLocale();
  renderAll(); // 收尾 syncDerivedReads 把可见图表也按新语言重绘一次
}

// ========== THEME (日间/夜间，入口唯一：设置弹窗「外观」) ==========
// 落 DOM class + localStorage，随后重绘 pill 与可见图表；目标与当前一致时不动、不重绘。
function syncThemeSeg() {
  const lightBtn = document.getElementById('theme-seg-light');
  if (!lightBtn) return;
  const dark = document.documentElement.classList.contains('dark');
  lightBtn.classList.toggle('active', !dark);
  lightBtn.setAttribute('aria-pressed', String(!dark));
  const darkBtn = document.getElementById('theme-seg-dark');
  darkBtn.classList.toggle('active', dark);
  darkBtn.setAttribute('aria-pressed', String(dark));
}

// 状态栏/地址栏颜色跟随**应用主题**（media 版本会在「系统亮、页面暗」时反色）。取 --bg 不另写色值。
function applyThemeChrome() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) meta.content = bg;
}

function setTheme(dark) {
  dark = !!dark;
  if (dark === document.documentElement.classList.contains('dark')) return;
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('dark-mode', dark ? '1' : '');
  applyThemeChrome(); // 状态栏跟纸色，不留一块上白下褐
  syncThemeSeg(); // 回显 seg 状态
  renderAll(); // 收尾 syncDerivedReads 把可见图表也按新主题重绘（canvas 不认 CSS 变量）
}

function showSettings() {
  passEditing = false; // 每次打开都回到「已设置」那一态
  syncThemeSeg();
  syncLangSeg();
  syncBackupControls();
  syncSnapshotReminderControls();
  openModal('settings-modal');
}

function refreshVisibleCharts() {
  if (document.getElementById('tab-chart').style.display !== 'none') renderChart();
  if (document.getElementById('tab-history').style.display !== 'none') renderHistoryChart();
  if (document.getElementById('tab-income').style.display !== 'none') renderIncomeTab();
  if (document.getElementById('tab-expense-chart').style.display !== 'none') renderExpenseChart();
  if (document.getElementById('tab-expense-trend').style.display !== 'none') renderExpenseTrendChart();
  if (document.getElementById('tab-expense-trend').style.display !== 'none') renderHeatmap();
}

// ===== 派生读数的唯一刷新口 =====
// 账本一变，报头/压测条与印徽/可见图表都在这里重算；新增派生读数就挂这里，数值一律现算（调用方不传数）。
let _renderBatch = 0; // 批量重绘期间先攒着（两侧列表各收一次会把同一张图画两遍）
function syncDerivedReads() {
  if (_renderBatch) return;
  renderMasthead();
  renderStressChrome();
  renderHeatmapNotice();
  refreshVisibleCharts();
}

// ========== IMPORT/EXPORT ==========
function showImportExport() {
  syncBackupControls(); // 打开弹窗时同步「上次备份」与频率选择
  openModal('io-modal');
}

// ========== BACKUP (确认框 + 文件窗口 + 新鲜度提醒) ==========
// 必须先弹确认框（自动备份没有用户手势，目录授权跨会话也不可靠）；决策在 logic.js，这里只做 DOM 副作用。

// 目录句柄不能进 state（不可 JSON 序列化，也不该随导出走）：只存 IndexedDB。
// 全部读写容错——隐私模式 / IDB 不可用时退化为「仅本次会话可用」，不阻塞首屏。
const BACKUP_DB = 'wealth-backup';
const BACKUP_STORE = 'handles';
const BACKUP_DIR_KEY = 'backupDir';
let backupDirHandle = null;
let backupDirReady = Promise.resolve();
let backupDirTouched = false; // 用户已主动选择/清除：启动恢复不得覆盖新值
let dirPickInFlight = false;
let backupInFlight = false; // 一次落盘从「弹窗口」到「写完」全程占位：防同一份被并行写两次

function openBackupDB() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no-idb'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(BACKUP_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('idb-blocked'));
  });
}

// 目录句柄读写的唯一事务入口：成功以 tx.oncomplete 为准（单条请求的回执不代表已提交）
async function idbBackupStore(mode, run) {
  const db = await openBackupDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, mode);
      const req = run(tx.objectStore(BACKUP_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function idbGetBackupDir() {
  const rec = await idbBackupStore('readonly', store => store.get(BACKUP_DIR_KEY));
  const h = rec && rec.handle;
  return h && typeof h.getFileHandle === 'function' ? h : null;
}

async function idbSetBackupDir(handle) {
  await idbBackupStore('readwrite', store => store.put({ handle }, BACKUP_DIR_KEY));
}

async function idbClearBackupDir() {
  await idbBackupStore('readwrite', store => store.delete(BACKUP_DIR_KEY));
}

// 启动恢复：失败/为空都按「未选择」处理；用户已在本次会话操作过则不回滚
async function restoreBackupDir() {
  try {
    const h = await idbGetBackupDir();
    if (h && !backupDirTouched) backupDirHandle = h;
  } catch (e) { /* IndexedDB 不可用：本次会话没有持久句柄 */ }
  syncBackupControls();
}

// 只认 Chromium 系的 File System Access API：没有它就没有「指定起点目录的文件窗口」，
// 落点只能回退成浏览器下载（backup.backupWritePlan 会据此判定）
function canPickBackupDir() { return typeof window.showDirectoryPicker === 'function'; }
function canSaveBackupFile() { return typeof window.showSaveFilePicker === 'function'; }

// ===== 设置入口（onclick 只挂同步包装；异步实现单独命名）=====
function chooseBackupDir() { chooseBackupDirAsync(); }

async function chooseBackupDirAsync() {
  if (!canPickBackupDir()) {
    toast(i18n.t('当前浏览器不支持选择文件夹，备份将下载到「下载」文件夹'), 'info');
    return;
  }
  if (dirPickInFlight) return;
  dirPickInFlight = true;
  try {
    // 第一个 await 之前先弹选择器：拖到别的 await 之后会丢失用户手势。
    // mode 只要 read：这个句柄只用来给文件窗口指定起点（startIn），不再往目录里直接写文件，
    // 所以不必再申请写权限——那正是「每次重开都要重新授权」的来源。
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    backupDirTouched = true;
    backupDirHandle = handle;
    try { await idbSetBackupDir(handle); } catch (e) { /* 本次会话仍可用，刷新后需重选 */ }
    syncBackupControls();
    toast(i18n.t('已选择备份文件夹「{p1}」', { p1: handle.name || i18n.t('备份文件夹') }), 'success');
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 用户取消，不打扰
    toast(i18n.t('选择文件夹失败'), 'error');
  } finally { dirPickInFlight = false; }
}

// 只忘句柄与持久化记录，不删除任何文件
function clearBackupDir() {
  showConfirm(i18n.t('确认清除备份文件夹？'), () => clearBackupDirAsync());
}

async function clearBackupDirAsync() {
  backupDirTouched = true;
  backupDirHandle = null;
  try { await idbClearBackupDir(); } catch (e) { /* IDB 不可用：内存已清 */ }
  syncBackupControls();
  toast(i18n.t('已清除备份文件夹'), 'success');
}

const PASS_KEY = 'wealth-manager-passphrase';
let passEditing = false;

function exportPassphrase() {
  try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; }
}

async function backupFileText() {
  const text = backup.backupJSONText(state);
  const pass = exportPassphrase();
  return pass ? await vault.encryptBackup(text, pass) : text;
}

function saveExportPassphrase() {
  const input = document.getElementById('pass-input');
  const pass = input.value;
  if (vault.passphraseTooShort(pass)) {
    toast(i18n.t('密钥至少 {p1} 位', { p1: vault.BACKUP_PASSPHRASE_MIN }), 'error');
    return;
  }
  try { localStorage.setItem(PASS_KEY, pass); } catch (e) {
    toast(i18n.t('保存失败：浏览器不允许本地存储'), 'error');
    return;
  }
  input.value = '';
  passEditing = false;
  syncBackupControls();
  toast(i18n.t('已设置导出密钥，之后的导出都会加密'), 'success');
}

function startPassEdit() {
  passEditing = true;
  syncBackupControls();
  document.getElementById('pass-input').focus();
}

function clearExportPassphrase() {
  showConfirm(i18n.t('确认清除导出密钥？清除后导出的是明文文件；已加密的备份仍要原密钥才能打开。'), () => {
    try { localStorage.removeItem(PASS_KEY); } catch (e) {}
    passEditing = false;
    syncBackupControls();
    toast(i18n.t('已清除导出密钥'), 'success');
  });
}

// ===== 落盘 =====
// 唯一落盘入口：调用前不得有 await（手势会被消耗掉）；close() 成功才算写完；取消返回 'cancelled'，不记任何状态。
async function saveBackupToFile(today, mode) {
  if (backupInFlight) return 'cancelled';
  backupInFlight = true;
  let notice;
  let stage = 'picker';
  try {
    const opts = {
      suggestedName: backup.backupFileName(today),
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    };
    if (backupDirHandle) opts.startIn = backupDirHandle;
    let handle;
    try {
      handle = await window.showSaveFilePicker(opts);
    } catch (e) {
      if (!(e && e.name === 'TypeError' && opts.startIn)) throw e;
      delete opts.startIn;
      handle = await window.showSaveFilePicker(opts);
    }
    stage = 'encrypt';
    const text = await backupFileText();
    stage = 'write';
    await writeFileHandleText(handle, text);
    notice = backup.backupResultNotice({ mode, target: 'file', status: 'written' });
  } catch (e) {
    console.error('[backup] export failed at ' + stage, e);
    const cancelled = e && e.name === 'AbortError';
    notice = cancelled
      ? backup.backupResultNotice({ mode, target: 'file', status: 'cancelled' })
      : backup.exportErrorNotice(e, stage);
  } finally { backupInFlight = false; }
  applyBackupResult(notice, today);
}

// close() 成功才算写入完成；中途失败不会提交半截文件
async function writeFileHandleText(fh, text) {
  if (!fh || typeof fh.createWritable !== 'function') {
    e.name = 'bad-handle';
    throw e;
  }
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

// 触发一次浏览器下载（无回执，不能据此记「已备份」）
async function downloadBackupJSON() {
  const blob = new Blob([await backupFileText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backup.backupFileName(date.getLocalDateStr());
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function markBackedUp(today) {
  state.backup.lastBackup = today;
}

// 所有备份路径的唯一收尾点：按结果决定记不记成功，再统一刷新控件与便条。
// 只有「确认写入」才记 lastBackup；取消 / 失败 / 回退下载一律不记，
// 于是当天再进来还会再问一次（旧实现用 lastAutoDownload 节流，取消后当天就「没了」）
function applyBackupResult(notice, today) {
  if (notice.recordBackup) markBackedUp(today);
  if (notice.recordBackup) { try { saveState(); } catch (e) {} }
  syncBackupControls();
  toast(notice.msg, notice.type);
}

// 方案 A 入口：判定在 backup.shouldAutoBackup，这里延迟数秒执行，并先 await 本轮的汇率请求。
// 确认回调里不得有 await 就调 saveBackupToFile（手势）；快照提醒挂在备份收尾（取消回调 / 写入 finally）之后。
async function maybeAutoBackup(ratePromise) {
  const settle = () => maybeSnapshotReminder();
  if (!backup.shouldAutoBackup(state, date.getLocalDateStr())) {
    setTimeout(settle, 1500); // 没有备份要弹时自己走，延后一点避开首屏入场
    return;
  }
  setTimeout(async () => {
    try {
      if (ratePromise) await ratePromise;
    } catch (e) { /* 汇率拉取失败也无妨，用缓存汇率继续备份 */ }
    try {
      await backupDirReady; // 目录句柄从 IDB 恢复完成后再弹框（确认文案要写目录名）
      const t = date.getLocalDateStr();
      const prompt = backup.backupPromptText('auto', backup.backupFileName(t), backupDirHandle && backupDirHandle.name);
      showConfirm(prompt.msg, () => {
        const plan = backup.backupWritePlan({ supportsPicker: canSaveBackupFile() });
        const written = plan.target === 'file' ? saveBackupToFile(t, 'auto') : exportViaDownload(t);
        Promise.resolve(written).finally(settle);
      }, prompt.title, { okLabel: i18n.t('备份'), tone: 'gold', onCancel: settle });
    } catch (e) { /* 忽略 */ }
  }, 4000);
}

// ========== 月度快照提醒（DOM 副作用）==========
// 决策全在 logic.js snapshot.shouldRemindSnapshot；这里只写 DOM、记「今天问过」。
// 提醒只是通知：不跳转、不过闸、不带入口按钮——门槛（DECISIONS.md）保护的是「看数字」，
// 提醒不替用户省这笔钱；文案又只报月份、不报金额（不变成一条旁路读数）。
function maybeSnapshotReminder() {
  const today = date.getLocalDateStr();
  if (!snapshot.shouldRemindSnapshot(state, today)) return;
  // 用户正在干别的事（已经开了一层弹窗）就不抢：提醒只是知会，不值得把人家手里的表单顶下去。
  // 没弹就不记 lastPrompted，窗口内下次启动再试。
  if (topModal()) return;
  const text = snapshot.snapshotReminderText(state);
  document.getElementById('snapshot-reminder-msg').textContent = text.msg;
  // 弹出那一刻就记「今天问过」：只有一个按钮，看不看用户的选择都已计价。
  state.snapshotReminderLastPrompted = today;
  saveState();
  openModal('snapshot-reminder-modal');
}

function closeSnapshotReminder() {
  closeModal('snapshot-reminder-modal');
}

function checkBackupStale() {
  const staleDays = backup.backupStaleDays(state, date.getLocalDateStr());
  if (staleDays != null) {
    setTimeout(() => toast(i18n.t('距上次备份已 {p1} 天，记得导出一份', { p1: staleDays }), 'error'), 1500);
  }
}

function syncBackupControls() {
  const freq = backup.normalizeBackupFreq(state.backup.autoFreq);       // 白名单归一，单一来源
  const passSet = !!exportPassphrase();
  const noteText = backup.backupNoteText(state.backup.lastBackup, date.getLocalDateStr()); // 文案纯函数在 logic.js
  const lastEl = document.getElementById('backup-last-text');
  if (lastEl) lastEl.textContent = noteText + ' · ' + vault.backupModeText(passSet);
  ['daily', 'weekly', 'off'].forEach(v => {
    const btn = document.getElementById('backup-freq-' + v);
    if (!btn) return;
    btn.classList.toggle('active', v === freq);
    btn.setAttribute('aria-pressed', String(v === freq));
  });
  const noteEl = document.getElementById('settings-backup-note');
  if (noteEl) noteEl.textContent = noteText;
  const dirNote = document.getElementById('settings-backup-dir-note');
  if (dirNote) {
    dirNote.textContent = backup.backupDirNoteText(!!backupDirHandle, backupDirHandle && backupDirHandle.name, canPickBackupDir());
  }
  const clearBtn = document.getElementById('backup-dir-clear');
  if (clearBtn) clearBtn.hidden = !backupDirHandle;
  const editing = !passSet || passEditing;
  const passInput = document.getElementById('pass-input');
  const passSave = document.getElementById('pass-save');
  const passChange = document.getElementById('pass-change');
  const passClear = document.getElementById('pass-clear');
  if (passInput) passInput.hidden = !editing;
  if (passSave) passSave.hidden = !editing;
  if (passChange) passChange.hidden = editing;
  if (passClear) passClear.hidden = !passSet;
}

function setBackupFreq(v) {
  state.backup.autoFreq = backup.normalizeBackupFreq(v); // 白名单归一与 migrate.migrateState 同源（logic.js）
  saveState();
  syncBackupControls(); // 两处弹窗控件同源刷新
  toast(state.backup.autoFreq === 'off' ? i18n.t('已关闭自动备份') : i18n.t('自动备份：{p1}', { p1: i18n.t(state.backup.autoFreq === 'daily' ? '每天' : '每周') }), 'success');
}

function setSnapshotReminder(patch) {
  state.snapshotReminder = snapshot.normalizeSnapshotReminder(Object.assign({}, state.snapshotReminder, patch));
  saveState();
  syncSnapshotReminderControls(); // 归一后回写到输入框（0 / 99 / 空 都落到 1~28）
}
function setSnapshotReminderWindow(v) { setSnapshotReminder({ window: v }); }
function setSnapshotReminderDays(v) { setSnapshotReminder({ days: v }); }

// 回显：seg 的 aria-pressed 与天数输入框同一来源，不各读一遍 state
function syncSnapshotReminderControls() {
  const r = snapshot.normalizeSnapshotReminder(state.snapshotReminder);
  ['off', 'start', 'end'].forEach(v => {
    const btn = document.getElementById('snap-remind-' + v);
    if (!btn) return;
    btn.classList.toggle('active', v === r.window);
    btn.setAttribute('aria-pressed', String(v === r.window));
  });
  const days = document.getElementById('snapshot-reminder-days');
  if (days) days.value = String(r.days);
}

function exportData() {
  syncBackupControls(); // 两处「上次备份」显示同源刷新（既有契约）
  exportDataAsync();
}

// 手动导出：点按钮本身就是确认，直接进文件窗口（不再多一层确认框）
async function exportDataAsync() {
  const today = date.getLocalDateStr();
  const plan = backup.backupWritePlan({ supportsPicker: canSaveBackupFile() });
  if (plan.target !== 'file') {
    exportViaDownload(today);
    return;
  }
  await saveBackupToFile(today, 'manual');
}

// 不支持文件窗口时的兜底：<a download> 无回执，只提示「已开始下载」，不记「已备份」
async function exportViaDownload(today) {
  let notice;
  try {
    await downloadBackupJSON();
    notice = backup.backupResultNotice({ mode: 'manual', target: 'download', status: 'downloaded' });
  } catch (e) {
    console.error('[backup] download did not start', e);
    notice = backup.exportErrorNotice(e, 'write');
  }
  applyBackupResult(notice, today);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // 重置，允许再次选择同一文件导入
  document.getElementById('import-file-name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = function(ev) {
    let data;
    try {
      data = JSON.parse(ev.target.result);
    } catch(err) {
      toast(i18n.t('解析文件失败'), 'error');
      return;
    }
    if (vault.isEncryptedBackup(data)) { askImportPassphrase(data); return; }
    confirmImport(data);
  };
  reader.readAsText(file);
}

function confirmImport(data) {
  if (data && Array.isArray(data.categories) && Array.isArray(data.assets)) {
    showConfirm(i18n.t('导入将覆盖当前所有数据，确认继续？'), () => {
      state = { ...state, ...data };
      migrate.migrateState();
      saveState();
      renderAll();
      closeModal('io-modal');
      toast(i18n.t('数据已导入'), 'success');
    }, null, { onCancel: () => { document.getElementById('import-file-name').textContent = ''; } });
  } else {
    toast(i18n.t('文件格式不正确'), 'error');
  }
}

let pendingImportEnv = null;
function askImportPassphrase(env) {
  pendingImportEnv = env;
  const input = document.getElementById('pass-modal-input');
  input.value = '';
  openModal('pass-modal');
  input.focus();
}

function cancelPassImport() {
  pendingImportEnv = null;
  document.getElementById('import-file-name').textContent = '';
  closeModal('pass-modal');
}

function passModalKey(e) {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitPassImport(); }
}

function submitPassImport() { submitPassImportAsync(); }

async function submitPassImportAsync() {
  const env = pendingImportEnv;
  if (!env) return;
  const input = document.getElementById('pass-modal-input');
  let text;
  try {
    text = await vault.decryptBackup(env, input.value);
  } catch (err) {
    input.value = '';
    input.focus();
    toast(i18n.t('密钥不对，或文件已损坏'), 'error');
    return;
  }
  pendingImportEnv = null;
  closeModal('pass-modal');
  let data;
  try { data = JSON.parse(text); } catch (err) {
    toast(i18n.t('解开了，但里面不是账本 JSON'), 'error');
    return;
  }
  confirmImport(data);
}

// ========== UTILS ==========
/* 悬停气泡的定位：把气泡钉在 ? 图标下方（视口坐标）。
   为什么需要 JS：气泡是 position: fixed（脱离祖先的层叠上下文与 overflow 裁剪，见 CSS 注释），
   于是它不再跟着图标走——位置只能每次显示时按当前滚动/布局算一次。
   纯算术在 logic.js ui.tipBubblePos（可单测），这里只负责量尺寸与写两个 CSS 变量。
   九个 tip 共用这一套（气泡是单一实现，不再逐个写定位）。 */
function placeTipBubble(tip) {
  if (!tip) return;
  const bubble = tip.querySelector('.tip-bubble');
  const mark = tip.querySelector('.tip-mark');
  if (!bubble || !mark) return;
  // **先搬家再量**：`fixed` 的包含块不是视口本身——祖先若带 backdrop-filter（卡片就有），
  // 它就成了包含块，坐标会相对那张卡片算（实测 left:725 渲染到 814，正好差一个内边距）。
  // 搬到 body 下才真正相对视口；隐藏时再搬回去，`.tip:hover .tip-bubble` 这条选择器
  // 才不会失效（那条只认结构上的子孙关系）。
  if (bubble.parentElement !== document.body) document.body.appendChild(bubble);
  bubble.classList.add('placed');
  const a = mark.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const pos = ui.tipBubblePos(a, b.width, b.height, { w: window.innerWidth, h: window.innerHeight });
  bubble.style.setProperty('--tip-x', pos.left + 'px');
  bubble.style.setProperty('--tip-y', pos.top + 'px');
  tip.__bubble = bubble;
}
// 重绘前的收尾：挂在 body 下的气泡已经不在原来那棵 DOM 里了，重绘会再生成一份同 id 的，
// 两份同时存在 → `getElementById` 拿到哪一份取决于顺序（实测 E2E 报「resolved to 2 elements」）。
// 故任何会重绘这块内容的路径都先调它，把遗留的那份扔掉（它的宿主已经不存在）。
function dropDetachedBubbles() {
  document.querySelectorAll('body > .tip-bubble').forEach(b => b.remove());
}

function unplaceTipBubble(tip) {
  if (!tip || !tip.__bubble) return;
  const b = tip.__bubble;
  b.classList.remove('placed');
  if (b.parentElement === document.body) {
    const mark = tip.querySelector('.tip-mark');
    if (mark && mark.nextSibling) tip.insertBefore(b, mark.nextSibling);
    else tip.appendChild(b);
  }
  tip.__bubble = null;
}
// 单一入口：事件委托（tip 是动态渲染的，逐个挂监听会在每次重绘时留下悬挂的闭包）
document.addEventListener('mouseover', e => {
  const tip = e.target.closest && e.target.closest('.tip');
  if (tip) placeTipBubble(tip);
});
document.addEventListener('focusin', e => {
  const tip = e.target.closest && e.target.closest('.tip');
  if (tip) placeTipBubble(tip);
});
// 指针/焦点离开就搬回原处：否则气泡留在 body 上，`:hover` 那条选择器再也够不到它
// （表现是「展开过一次之后，之后永远显示」）。relatedTarget 仍在同一个 tip 里就不算离开。
// 判「真的离开了」要看两处：仍在 .tip 里，或者移到了**已搬家的气泡**上（它现在挂在 body 下，
// 不再算 .tip 的子孙——只看 tip.contains 会把「指针移到气泡上」当成离开，气泡当场消失）。
const tipStillActive = (tip, next) => !next || tip.contains(next) || tip.__bubble === next || (tip.__bubble && tip.__bubble.contains(next));
document.addEventListener('mouseout', e => {
  const tip = e.target.closest && e.target.closest('.tip');
  if (tip && !tipStillActive(tip, e.relatedTarget)) unplaceTipBubble(tip);
});
document.addEventListener('focusout', e => {
  const tip = e.target.closest && e.target.closest('.tip');
  if (tip && !tipStillActive(tip, e.relatedTarget)) unplaceTipBubble(tip);
});
// 视口尺寸变了要重算（否则气泡会停在被裁掉的旧位置）
window.addEventListener('resize', () => {
  document.querySelectorAll('.tip:hover, .tip:focus-within').forEach(placeTipBubble);
});

function catColor(catId, tagName) {
  return catColorImpl(state.categories, catId, tagName);
}
function closeModal(id) {
  const modal = document.getElementById(id);
  const wasOpen = modal.style.display !== 'none';
  modal.style.display = 'none';
  syncScrollLock(); // 先按「还剩几层」重算，再还焦点（焦点可能落在背后页面上，那时已解冻）
  // 把焦点还给打开它的元素；只有真的关掉一层才出栈（否则会吃掉别的弹窗的返回焦点）。
  if (!wasOpen) return;
  const back = __modalReturnFocus.pop();
  if (back && document.contains(back) && back.focus) back.focus();
}

// custom confirm dialog —— 清空 / 删除 / 覆盖落盘前唯一的二次确认出口（ui-wiring 巡检把守）
let _confirmCallback = null;
let _confirmCancelCallback = null;
function showConfirm(msg, onOk, title, opts) {
  opts = opts || {};
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-title').textContent = title || i18n.t('确认操作');
  // 按钮文案与色调每次都重置：确认框全站共用，上一个调用留下的（如备份的金调）
  // 绝不能粘到下一个（删除这类真危险动作）确认上
  const ok = document.getElementById('confirm-ok-btn');
  ok.textContent = opts.okLabel || i18n.t('确认');
  ok.className = opts.tone === 'gold' ? 'btn-gold' : 'btn-danger';
  openModal('confirm-modal');
  _confirmCallback = onOk;
  // 取消回调也每次重置：与按钮文案/色调同一条规矩——上一个调用留下的东西
  // 绝不能粘到下一个确认框（否则一次删除确认的取消会触发上一次备份的收尾）
  _confirmCancelCallback = opts.onCancel || null;
  ok.focus();
}
function confirmCancel() {
  closeModal('confirm-modal');
  _confirmCallback = null;
  const onCancel = _confirmCancelCallback;
  _confirmCancelCallback = null;
  if (onCancel) onCancel();
}
document.getElementById('confirm-ok-btn').addEventListener('click', () => {
  if (__autoOpenedAt !== null && !ui.autoOpenGuard(performance.now() - __autoOpenedAt)) return;
  closeModal('confirm-modal');
  _confirmCancelCallback = null; // 确认路径不触发取消回调
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
});

let __modalMouseDownTarget = null;
document.addEventListener('mousedown', e => { __modalMouseDownTarget = e.target; });
document.addEventListener('click', e => {
  // 自动弹窗守卫窗内的遮罩 click 是抬手指的余波，不算「点了遮罩空白」
  if (__autoOpenedAt !== null && !ui.autoOpenGuard(performance.now() - __autoOpenedAt)) return;
  if (e.target.classList.contains('modal-overlay') && __modalMouseDownTarget && !__modalMouseDownTarget.closest('.modal-content')) {
    if (e.target.id === 'confirm-modal') {
      confirmCancel(); // 统一走 confirmCancel：隐藏 + 清空 _confirmCallback
    } else if (e.target.id === 'asset-gate-modal') {
      cancelAssetGate(); // 点遮罩 = 放弃本次（与 Esc 同一条出口）
    } else if (e.target.id === 'pass-modal') {
      cancelPassImport();
    } else {
      closeModal(e.target.id); // 必须走 closeModal：直接改 display 会把焦点管理整个绕过
    }
  }
  __modalMouseDownTarget = null;
});

// Tab 焦点陷阱：Tab 只能在上层弹窗内循环。
// 为什么必须做：弹窗背后是**还活着的**页面（本项目不用 <dialog> 的 inert），
// 不拦的话 Tab 会一路走进背后的表格与按钮——读屏器用户会以为弹窗已经关了。
// 判据（绕回谁、下标怎么算）在 logic.js ui.trapFocus（可单测），这里只负责把焦点移过去。
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const top = topModal();
  if (!top) return;
  const list = modalFocusables(top);
  const cur = list.indexOf(document.activeElement);
  const r = ui.trapFocus(cur, list.length, e.shiftKey);
  if (!r.wrap || !list[r.index]) return; // 中间位置交还浏览器默认行为
  e.preventDefault();
  list[r.index].focus();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const top = topModal();
  if (!top) return;
  if (top.id === 'asset-gate-modal') cancelAssetGate(); // 作废本次抄写（下次抬闸重新抽句）
  else if (top.id === 'confirm-modal') confirmCancel();
  else if (top.id === 'pass-modal') cancelPassImport();
  else closeModal(top.id); // 同上：ESC 也要还焦点，不能只改 display
});

function genId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function formatMoneyInput(el) {
  const sel = el.selectionStart;
  const raw = el.value;
  let clean = raw.replace(/[^\d.]/g, '');
  const dot = clean.indexOf('.');
  if (dot !== -1) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
  const parts = clean.split('.');
  const intFmt = (parts[0] || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = parts.length > 1 ? intFmt + '.' + parts[1] : intFmt;
  if (formatted !== raw) {
    el.value = formatted;
    let before = raw.slice(0, sel).replace(/[^\d.]/g, '');
    const bd = before.indexOf('.');
    if (bd !== -1) before = before.slice(0, bd + 1) + before.slice(bd + 1).replace(/\./g, '');
    const bp = before.split('.');
    const newPos = bp[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',').length + (bp.length > 1 ? 1 + bp[1].length : 0);
    el.setSelectionRange(newPos, newPos);
  }
}

// 统一提示便条：全站唯一的瞬时反馈出口（右下角 #toast-area 堆叠）。
// type 三态：success=操作成功（绿）/ error=出错待处理（红）/ info=系统中性知会（金墨边注）。
// 末尾同文案同类型且未在退场时只重置计时不再堆叠——自动触发的知会（汇率刷新、备份提醒）
// 撞上用户操作时不会糊成重复便条
function toast(msg, type) {
  const area = document.getElementById('toast-area');
  const prev = area.lastElementChild;
  if (prev && !prev.classList.contains('leaving') && prev.dataset.msg === msg && prev.dataset.type === String(type)) {
    clearTimeout(prev._hideTimer);
    armToastHide(prev);
    return;
  }
  // 播报档位按类型定：error 走 assertive（立刻打断朗读），其余 polite（择机播报）。
  // 写死在容器上就是「所有错误都排队」；档位写到容器而非每条便条上——
  // 读屏器只认 live region 的档位，逐条设 aria-live 无效。
  area.setAttribute('aria-live', ui.toastLiveMode(type));
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  t.dataset.msg = msg;
  t.dataset.type = String(type);
  area.appendChild(t); // 新便条贴最靠角处，旧便条自然上移（容器 bottom 锚定向上生长）
  armToastHide(t);
}

function armToastHide(t, delay) {
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => {
    if (toastHeld(t)) { armToastHide(t, 700); return; }
    t.classList.add('leaving');
    // 退场元素不该继续被对比度巡检/读屏器当成内容：标记 aria-hidden。
    // 归隐由 CSS 的 visibility 负责（顺带不再吃指针）；300ms 后移出 DOM（与退场过渡等长）。
    t.setAttribute('aria-hidden', 'true');
    setTimeout(() => t.remove(), 300);
  }, delay || 2500);
}

function toastHeld(t) {
  if (t.matches(':hover')) return true;
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed) return false;
  return t.contains(sel.anchorNode) || t.contains(sel.focusNode);
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
        <div class="flex gap-2 justify-end">
          <button onclick="editExpense('${text.jsAttr(e.id)}')" class="row-btn edit">${i18n.t('编辑')}</button>
          <button onclick="duplicateExpense('${text.jsAttr(e.id)}')" class="row-btn copy">${i18n.t('复制')}</button>
          <button onclick="deleteExpense('${text.jsAttr(e.id)}')" class="row-btn danger">${i18n.t('删除')}</button>
        </div>
      </div>`;
    }).join('');
  }

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const parts = [];
  if (view.active.month) parts.push(date.monthLabel(view.active.month));
  if (view.active.tag) parts.push(view.active.tag);
  if (q) parts.push(i18n.t('匹配'));
  const totalLabel = parts.length ? parts.join(' ') : i18n.t('合计');
  document.getElementById('expense-total-line').innerHTML =
    `${totalLabel} · <span class="tabular t-medium ink-accent">${money.formatCNY(total)}</span> · ${i18n.t('{p1} 笔', { p1: filtered.length })}`;

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

