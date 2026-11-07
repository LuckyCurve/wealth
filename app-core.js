// ========== STATE ==========
const LS_KEY = 'wealth-manager-data';
// 应用初始状态（单一来源）：顶层 state 与 loadState 异常回退共用，
// 保证损坏的 localStorage 不会残留半解析状态（rates/backup/预期等）。
function freshAppState() {
  return {
    categories: [], assets: [], snapshots: [],
    expenseCategories: [], expenses: [],
    rates: { CNY: 1, HKD: 1, USD: 1, fetchedAt: null },
    expenseExpectation: 0, netWorthTarget: 0, incomeSafetyFactor: 100, expenseGapDays: 3, gateLang: '',
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
        locale: i18n.flatpickrLocale(flatpickr.l10ns, state.lang),
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
  }
}

// ========== 进入资产页的门槛：长按抬闸 + 抄写放行 ==========
// 两段闸：指针先按住「资产」满 ui.MODE_PRESS_MS，抬闸后抄一句随机箴言才进。这不是权限，
// 是给「看一眼」定价；价格不因设备而异：合成 click 不付长按（按住 Enter 会按键重复），但抄写同价。
let modePressStart = null;
let modePressRaf = 0;
let assetGatePhrase = ''; // 本次要抄的那一句：抬闸时抽定，抄错也**不换句**
let assetGateLang = '';   // 抄写用哪种语言取句：'' = 跟界面语言

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
function gatePhraseLang() {
  return assetGateLang || i18n.normalizeLang(state.lang);
}

// 抽句与换句只走这里：换语言等于换一句全新的，已抄的一半不能留着
function drawAssetGatePhrase() {
  const lang = gatePhraseLang();
  assetGatePhrase = ui.entryPhrase(lang);
  document.getElementById('asset-gate-phrase').textContent = assetGatePhrase;
  document.getElementById('asset-gate-input').value = '';
  setAssetGateError(false);
  // 换句入口是标题旁的图标：无可见文字，文案只进气泡与 aria-label
  const btn = document.getElementById('asset-gate-lang');
  if (btn) {
    const label = lang === 'zh' ? i18n.t('换英文') : i18n.t('换中文');
    btn.setAttribute('aria-label', label);
    const bubble = document.getElementById('asset-gate-lang-tip');
    if (bubble) bubble.textContent = label;
    // 气泡亮着时换文案会改宽度，按新宽度重挂一次（否则钉在旧位置）
    const tip = btn.closest('.tip');
    if (tip && tip.querySelector('.tip-bubble.placed')) placeTipBubble(tip);
  }
}

function toggleAssetGatePhraseLang() {
  assetGateLang = gatePhraseLang() === 'zh' ? 'en' : 'zh';
  state.gateLang = assetGateLang;
  saveState();
  drawAssetGatePhrase();
  document.getElementById('asset-gate-input').focus();
}

function openAssetGate() {
  if (!assetsEntryOpen()) return;
  assetGateLang = state.gateLang === 'zh' || state.gateLang === 'en' ? state.gateLang : '';
  drawAssetGatePhrase();
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

