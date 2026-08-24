/*
 * logic.js — 财富管理 · 核心纯逻辑（可单测）
 * --------------------------------------------------------------------------
 * 从 index.html 的内联 <script> 中抽取出的「与 DOM 无关」的纯函数 / 数据逻辑，
 * 通过 UMD 双端复用：
 *   - 浏览器：<script src="logic.js"></script> 先于应用脚本加载，函数挂到全局，
 *     供 index.html 内联脚本按原名直接调用（运行时行为不变）。
 *   - Node：以 CommonJS 模块被 test/*.test.js 通过 require 引入，零依赖、无需构建。
 *
 * 约定：依赖全局可变状态（state / incomeMode）的函数在浏览器读取 index.html 的全局，
 * 在测试中通过 globalThis.state / globalThis.incomeMode 注入，签名保持不变。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    for (var k in api) {
      if (Object.prototype.hasOwnProperty.call(api, k)) root[k] = api[k];
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ========== 货币换算 ==========
  function toCNY(amount, currency) {
    return amount * (state.rates[currency] || 1);
  }

  function formatCNY(val) {
    return '¥' + val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // 按给定汇率表把外币金额折算为 CNY（rates/币种缺失按 1 兑底、金额非法归零）。
  // 与全局 toCNY 的区别：汇率表由调用方显式传入（快照用 snapshot.currencyRates，
  // 实时用 state.rates），保持纯净可测；堆叠柱聚合、快照对比、下钻明细共用此口径，
  // 防止图表色块值与弹窗明细各自漂移
  function amountAtRates(amount, currency, rates) {
    return (Number(amount) || 0) * (((rates || {})[currency]) || 1);
  }

  // ========== 月份 / 日期 ==========
  function addMonths(month, n) {
    const [y, m] = String(month).split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function getCurrentMonth() {
    return getLocalMonthStr();
  }

  // 本地日期/月份字符串（避免 toISOString 的 UTC 时区偏移，东八区凌晨会错一天/月）
  function getLocalDateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function getLocalMonthStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // 两个 'YYYY-MM-DD' 相差天数（b - a），用于自动备份节流与新鲜度提醒；
  // 手动拆解避免 new Date('YYYY-MM-DD') 按 UTC 解析的时区偏移；非法输入返回 null
  function daysBetweenStr(a, b) {
    const pa = String(a || '').split('-').map(Number);
    const pb = String(b || '').split('-').map(Number);
    if (pa.length !== 3 || pb.length !== 3 || pa.some(isNaN) || pb.some(isNaN)) return null;
    return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }

  function monthLabel(month) {
    // 手动拆解避免 new Date('YYYY-MM-01') 按 UTC 解析, 西半球时区（UTC-11/-12）会错月/年
    const [y, m] = String(month || '').split('-');
    return y && m ? y + '年' + parseInt(m, 10) + '月' : String(month || '');
  }

  // ========== 排序状态机（纯）==========
  // 三态循环：同列点击 升序 → 降序 → 取消排序（恢复自然/拖拽顺序）；换列则重置为新列升序。
  // 资产 toggleSort 与消费 toggleExpenseSort 共用同一状态机；
  // flipSticky=true 表达消费侧「首次点击保留旧行为」的粘性翻转（仅翻转方向、不进入循环），
  // 由调用方负责翻回 touched 标记。返回新 {by, dir}，不修改入参
  function nextSortState(by, dir, field, flipSticky) {
    if (by === field) {
      if (flipSticky) return { by: by, dir: dir === 'asc' ? 'desc' : 'asc' };
      if (dir === 'asc') return { by: by, dir: 'desc' };
      return { by: '', dir: 'asc' };
    }
    return { by: field, dir: 'asc' };
  }

  // 消费记录出现过的月份列表（去重、降序）：月份筛选下拉与趋势图维度下拉共用。
  // 防御缺失/空 date 的脏记录（filter(Boolean)），两处推导原先一份防御一份不防御，现统一单一来源
  function expenseMonths(expenses) {
    return [...new Set((expenses || []).map(e => (e.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  }

  // ========== 快照查询（依赖 state.snapshots）==========
  function findMonthSnapshot(month) {
    return state.snapshots.find(s => s.month === month);
  }

  function getPrevSnapshot(month) {
    return state.snapshots
      .filter(s => s.month < month)
      .sort((a, b) => b.month.localeCompare(a.month))[0] || null;
  }

  // ========== 消费月度聚合（纯函数，不依赖全局）==========
  // 按 'YYYY-MM' 聚合消费记录，返回升序 [{ month, total, count }]
  function monthlyExpenseTotals(expenses) {
    const map = {};
    (expenses || []).forEach(e => {
      const m = String(e && e.date || '').slice(0, 7);
      if (!m) return;
      if (!map[m]) map[m] = { month: m, total: 0, count: 0 };
      map[m].total += Number(e.amount) || 0;
      map[m].count++;
    });
    return Object.keys(map).sort().map(m => map[m]);
  }

  // 取指定月份之前、最近一个有数据的月份（自动跳过空月份，等价于资产快照的 getPrevSnapshot）
  // months: monthlyExpenseTotals 的升序输出；无更早月份时返回 null
  function prevExpenseMonthOf(month, months) {
    const prevs = (months || []).filter(x => x.month < month).map(x => x.month);
    return prevs.length ? prevs.sort().pop() : null;
  }

  // 环比：curr 与 prev 月度总额对比，返回 { diff, pct, up }
  // up = curr >= prev（花费「上涨」）；prev 为 0 时 pct 归 0（避免 Infinity）
  function expenseMoM(curr, prev) {
    const diff = (Number(curr) || 0) - (Number(prev) || 0);
    const pct = prev ? diff / prev * 100 : 0;
    const up = diff >= 0;
    return { diff, pct, up };
  }

  // 按「分类维度 + 标签」聚合某月消费（CNY），返回 { tag: total }；用于消费两月对比弹窗的逐标签拆分
  function expenseMonthTagTotals(month, catId, expenses) {
    const map = {};
    (expenses || []).forEach(e => {
      if (String(e && e.date || '').slice(0, 7) !== month) return;
      const tag = e.tags && e.tags[catId];
      if (!tag) return;
      map[tag] = (map[tag] || 0) + (Number(e.amount) || 0);
    });
    return map;
  }

  // ========== 收益测算（依赖 incomeMode / state）==========
  function getAssetRate(a, mode) {
    mode = mode || incomeMode;
    const min = a.expectedRateMin ?? a.expectedRate ?? 0;
    const max = a.expectedRateMax ?? a.expectedRate ?? 0;
    return mode === 'min' ? min : max;
  }

  // 安全边际因子: state.incomeSafetyFactor 为百分比 (默认 100 = 不打折), 返回 0.01~1 的折算系数
  function getSafetyFactor() {
    const f = Number(state.incomeSafetyFactor);
    if (!isFinite(f) || f <= 0) return 1;
    return Math.min(1, f / 100);
  }

  // 现金比例: 0~100 (%)，预期收益中来自股息/利息/租金等现金流的比例；缺失视为 100（全额现金，旧版行为）
  function getCashRatio(a) {
    const r = Number(a.cashRatio);
    return isFinite(r) ? Math.min(100, Math.max(0, r)) / 100 : 1;
  }

  // 任一资产的预期年化（Min 或 Max）> 0。「设了利率才显示月收益」的判定原先在
  // masthead 与收益 Tab 各写一份（?? 与 || 两种写法各自漂移），现收敛单一来源。
  // 注：?? 与 || 对 ''/NaN/0 等假值结果一致，收敛不改变行为
  function hasAnyRatedAsset(assets) {
    return (assets || []).some(a =>
      (a.expectedRateMin ?? 0) > 0 || (a.expectedRateMax ?? 0) > 0);
  }

  // 现金比例展示值（0~100 整数）：资产列表「· 现金 N%」、收益表格「现金比例」列、
  // 收益旭日图 tooltip 三处共用的同一舍入口径，防止一处取整一处截断
  function cashRatioPct(a) {
    return Math.round(getCashRatio(a) * 100);
  }

  // 收益拆分: annual/monthly/daily 为总资产收益（现有口径）；cash* 为其中现金收益（能付账单的部分）
  function calcAssetIncome(a, mode) {
    mode = mode || incomeMode;
    const rate = getAssetRate(a, mode);
    const cny = toCNY(a.amount, a.currency);
    const factor = getSafetyFactor();
    const annual = cny * rate / 100 * factor;
    const cashAnnual = annual * getCashRatio(a);
    const monthly = annual / 12;
    const daily = annual / 365;
    const cashMonthly = cashAnnual / 12;
    return { cny, annual, monthly, daily, cashAnnual, cashMonthly };
  }

  // ========== 数据迁移 / 兜底（依赖全局 state，原地修改）==========
  // loadState（本地加载）与 importData（JSON 导入）共用，保证旧版数据导入后行为一致
  function migrateState() {
    if (!Array.isArray(state.snapshots)) state.snapshots = [];
    // migrate old snapshot format (with 'id') to new monthly format
    if (state.snapshots.length > 0 && state.snapshots.some(s => s && s.date && !s.month)) {
      const oldSnaps = state.snapshots.filter(s => s && s.date && !s.month);
      const newSnaps = state.snapshots.filter(s => !(s && s.date && !s.month));
      const grouped = {};
      oldSnaps.forEach(s => {
        const m = String(s.date).slice(0, 7);
        if (!grouped[m] || new Date(s.date) > new Date(grouped[m].date)) {
          grouped[m] = s;
        }
      });
      state.snapshots = [
        ...newSnaps,
        ...Object.entries(grouped).map(([month, s]) => ({
          month,
          note: s.note || '',
          totalCNY: s.totalCNY,
          currencyRates: s.currencyRates,
          assets: s.assets,
          updatedAt: s.date,
        })),
      ];
    }
    // 补全快照加工字段：新版导出已剥离 totalCNY（纯原始数据）, 导入时按快照时点
    // 汇率重算（与 confirmSnapshot 保存时算法一致）, 保证历史净值图表/详情可用
    state.snapshots.forEach(s => {
      if (s && s.totalCNY == null) {
        const snapRates = s.currencyRates || state.rates;
        s.totalCNY = (s.assets || []).reduce((sum, a) =>
          sum + (a.amount || 0) * (snapRates[a.currency] || 1), 0);
      }
    });
    // ensure categories/assets arrays
    if (!Array.isArray(state.categories)) state.categories = [];
    if (!Array.isArray(state.assets)) state.assets = [];
    // ensure currency category exists
    if (!state.categories.find(c => c.id === 'currency')) {
      state.categories.unshift({ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] });
    }
    // ensure rates object（导入数据可能缺失或损坏）
    if (!state.rates || typeof state.rates !== 'object' || state.rates.CNY == null) {
      state.rates = { CNY: 1, HKD: 1, USD: 1, fetchedAt: null };
    } else {
      // 补全缺失货币字段，避免 toCNY 按 1:1 兜底导致数值失真
      if (state.rates.HKD == null) state.rates.HKD = 1;
      if (state.rates.USD == null) state.rates.USD = 1;
    }
    // 备份设置（旧数据/导入文件可能缺失）：默认每天自动下载，'off' 表示关闭；
    // lastBackup 含手动导出（新鲜度提醒用），lastAutoDownload 仅节流自动下载
    if (!state.backup || typeof state.backup !== 'object') state.backup = {};
    state.backup.autoFreq = normalizeBackupFreq(state.backup.autoFreq);
    if (!state.backup.lastBackup) state.backup.lastBackup = null;
    if (!state.backup.lastAutoDownload) state.backup.lastAutoDownload = null;
    // 用户设置字段（旧数据可能缺失）
    if (state.expenseExpectation == null) state.expenseExpectation = 0;
    if (state.netWorthTarget == null) state.netWorthTarget = 0;
    if (state.incomeSafetyFactor == null) state.incomeSafetyFactor = 100;
    state.incomeSafetyFactor = Math.min(100, Math.max(1, Number(state.incomeSafetyFactor) || 100));
    // migrate expectedRate -> expectedRateMin/Max (only if new fields not present)
    state.assets.forEach(a => {
      if (a.expectedRate != null && a.expectedRateMin == null) {
        a.expectedRateMin = a.expectedRate;
        a.expectedRateMax = a.expectedRate;
      }
      if (a.expectedRateMin == null) a.expectedRateMin = 0;
      if (a.expectedRateMax == null) a.expectedRateMax = 0;
      delete a.expectedRate;
      // 防御: 导入数据中利率可能是字符串, 统一转为数字
      a.expectedRateMin = Number(a.expectedRateMin) || 0;
      a.expectedRateMax = Number(a.expectedRateMax) || 0;
      // 现金比例: 缺失默认 100（全额现金，旧版「全部收益视为收入」行为）；越界钳制 0~100
      if (a.cashRatio == null) a.cashRatio = 100;
      a.cashRatio = Math.min(100, Math.max(0, Number(a.cashRatio) || 0));
      // 防御: 导入数据中 amount 可能是字符串, 统一转为数字
      if (a.amount != null) a.amount = Number(a.amount) || 0;
    });
    // init expense data
    if (!Array.isArray(state.expenses)) state.expenses = [];
    state.expenses.forEach(e => {
      if (e && e.amount != null) e.amount = Number(e.amount) || 0;
    });
    if (!Array.isArray(state.expenseCategories)) {
      state.expenseCategories = [];
    } else {
      // migrate: remove old builtin expense categories
      state.expenseCategories = state.expenseCategories.filter(c => c.id !== 'expense-type' || !c.builtin);
      // clean up orphaned tag references
      const validCatIds = new Set(state.expenseCategories.map(c => c.id));
      state.expenses.forEach(e => {
        if (e && e.tags) {
          Object.keys(e.tags).forEach(catId => {
            if (!validCatIds.has(catId)) delete e.tags[catId];
          });
        }
      });
    }
  }

  // ========== 文本 / 金额工具 ==========
  let _escDiv = null;
  function esc(str) {
    // 与浏览器行为对齐：浏览器走 DOM textContent 序列化（& < >），再手动补引号转义；
    // Node 无 document 时用等价正则兜底，保证单测确定性。
    str = String(str == null ? '' : str);
    if (typeof document === 'undefined') {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;');
    }
    if (!_escDiv) _escDiv = document.createElement('div');
    _escDiv.textContent = str;
    return _escDiv.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  }

  function escRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // 搜索命中高亮: 先 esc 转义再做不区分大小写替换, 保留原文大小写; 查询词同走 esc 保证 & < > 等字符一致
  function highlightMatch(text, q) {
    const escaped = esc(text);
    if (!q) return escaped;
    try {
      return escaped.replace(new RegExp(escRegExp(esc(q)), 'gi'), m => `<mark class="search-hit">${m}</mark>`);
    } catch (e) {
      return escaped;
    }
  }

  // 数字 → 千分位字符串（回填输入框用）
  function moneyStr(v) {
    if (v == null || v === '') return '';
    const num = Number(String(v).replace(/,/g, ''));
    if (isNaN(num)) return '';
    const [int, dec] = String(num).split('.');
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec != null ? '.' + dec : '');
  }

  // 金额千分位 2 位格式化（与 formatCNY 区别: 不带 ¥ 符号；与 moneyStr 区别: 恒为两位小数的展示态，
  // 用于表格/对比/tooltip 等只读场景）。原先内联在 index.html，与 formatCNY/moneyStr 同族归此集中
  function money2(v) {
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // 用于行内事件属性（onclick="fn('...')"）里的 JS 字符串参数：
  // 先 JS 字符串转义（\\ → \\, ' → \'），再做 HTML 属性转义（& "）。
  function jsAttr(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
  }

  // ========== 标签截断 ==========
  function truncateLabel(name, fontSize, maxPx) {
    name = String(name == null ? '' : name);
    const cw = ch => (ch.codePointAt(0) > 0xFF ? fontSize : fontSize * 0.6);
    let px = 0;
    for (const ch of name) px += cw(ch);
    if (px <= maxPx) return name;
    let out = '';
    px = 0;
    for (const ch of name) {
      const w = cw(ch);
      if (px + w + fontSize > maxPx) break; // 预留省略号「…」宽度
      out += ch;
      px += w;
    }
    return out + '…';
  }

  // ========== 颜色数学（纯）==========
  // #RRGGBB → rgba() 字符串（chips 选中 ring 等半透明描边用）。与 HSL 家族同属颜色数学，
  // 原先散在 index.html，现归拢到此处统一单测
  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      let d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let a = s * Math.min(l, 1 - l);
    let f = n => {
      let k = (n + h * 12) % 12;
      let c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  // 分类 pill 配色：同一色相下按标签序数插值（亮色: 浅底深字 / 暗色: 深底浅字）。
  function pillColors(base, t, dark) {
    const h = hexToHsl(base.bg).h;
    if (dark) {
      return {
        bg: hslToHex(h, 32 + t * 14, 14 + t * 7),
        fg: hslToHex(h, 44, 74 - t * 4),
        border: hslToHex(h, 30 + t * 16, 25 + t * 8),
      };
    }
    return {
      bg: hslToHex(h, 35 + t * 20, 90 - t * 20),
      fg: hslToHex(h, 50, 38),
      border: hslToHex(h, 30 + t * 18, 78 - t * 26),
    };
  }

  // 单标签/无标签时取分类基色；暗色下转为同色相深底浅字
  function basePill(base, dark) {
    return dark ? pillColors(base, 0, true) : { ...base };
  }

  // ========== 图表数据构造（纯，可单测）==========
  // 旭日图 / 堆叠柱调色板：资产/收入/消费/历史/趋势五图共用同一套暖色配色。
  // 原定义在 index.html，迁移至此处以便逻辑与单测共用同一份数据源。
  const CATEGORY_PALETTE = [
    { base: '#BF4A3A', shades: ['#D57262', '#E4988C', '#F2C2BA'] },
    { base: '#4A8C6F', shades: ['#72A88E', '#97C3AE', '#C0DACE'] },
    { base: '#E0A038', shades: ['#EABB69', '#F2D197', '#F8E6C5'] },
    { base: '#4A7BA7', shades: ['#6B9DC5', '#8FB9DB', '#B5D3ED'] },
    { base: '#B06A4B', shades: ['#C58D74', '#D8B09D', '#EBD1C4'] },
    { base: '#7A6E9E', shades: ['#9B91BA', '#BAB3D3', '#D8D3E8'] },
    { base: '#C0803C', shades: ['#D3A16A', '#E2BF98', '#F0DDC6'] },
    { base: '#3D8A80', shades: ['#69A69B', '#92C1B8', '#BBDAD4'] },
    { base: '#C75B39', shades: ['#D98367', '#E7A99A', '#F4CFC5'] },
    { base: '#A0635A', shades: ['#B9877E', '#CEABA5', '#E3CDCA'] },
  ];

  // 旭日图数据构造（资产/收入/消费三图共用）：给定分类与「按标签分组的子项数组」，
  // 统一套用 CATEGORY_PALETTE 配色。childValue(child) 决定扇区数值；
  // child 可携带 extra 字段（如 _assetId）透传到 ECharts 节点。数值统一四舍五入两位。
  function buildSunburstData(cat, groups, childValue) {
    return cat.tags
      .filter(t => (groups[t] || []).length > 0)
      .map((tag, ti) => {
        const pal = CATEGORY_PALETTE[ti % CATEGORY_PALETTE.length];
        const children = (groups[tag] || []).map((child, ai) => {
          const node = {
            name: child.name,
            value: Math.round(childValue(child) * 100) / 100,
            itemStyle: { color: pal.shades[ai % pal.shades.length] },
          };
          if (child.extra) Object.assign(node, child.extra);
          return node;
        });
        return { name: tag, itemStyle: { color: pal.base }, children };
      });
  }

  // 占比百分比字符串（1 位小数），用于图表 tooltip / 标签；分母为 0 时返回 '0.0'
  function pctStr(value, total) {
    return total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
  }

  // 堆叠柱状图图例选中态清理（历史净值/消费趋势共用）：
  // 只保留当前仍存在的系列名——切换分类/数据集后，旧分类的隐藏项不应误伤新系列。
  // 返回新对象不修改入参；selected 缺失或 validNames 非数组时安全兜底为空对象
  function pruneLegendSelected(selected, validNames) {
    const out = {};
    const names = Array.isArray(validNames) ? validNames : [];
    Object.keys(selected || {}).forEach(name => {
      if (names.indexOf(name) >= 0) out[name] = selected[name];
    });
    return out;
  }

  // 堆叠柱状图「占比模式」数据转换：保留原始金额(raw) 的同时给出百分比数值
  function percentSeriesData(raw, totals) {
    return raw.map((v, vi) => ({
      value: totals[vi] > 0 ? +(v / totals[vi] * 100).toFixed(1) : 0,
      raw: Math.round(v * 100) / 100,
    }));
  }

  // ========== 数据防丢备份决策（接收显式 state 参数，保持纯净可测）==========
  // 提醒阈值：距上次备份超过该天数视为「久未备份」
  const BACKUP_STALE_DAYS = 7;

  // 是否有值得备份的数据（assets/expenses/snapshots 任一非空；字段缺失按空处理）
  function hasAnyBackupWorthyData(s) {
    s = s || {};
    return (s.assets || []).length > 0 ||
           (s.expenses || []).length > 0 ||
           (s.snapshots || []).length > 0;
  }

  // 频率白名单归一：合法值原样返回，其余（含 undefined/null/非法字符串）归 'daily'。
  // migrateState 兑底与弹窗 setBackupFreq 共用，保证单一数据来源
  function normalizeBackupFreq(v) {
    return ['daily', 'weekly', 'off'].includes(v) ? v : 'daily';
  }

  // 备份状态文案：「上次备份 X（今天）」/「尚未备份过」。
  // 「备份与导入」弹窗与设置弹窗共用，避免两处文案漂移；参数显式传入保持纯净可测
  function backupNoteText(lastBackup, today) {
    if (!lastBackup) return '尚未备份过';
    return `上次备份 ${lastBackup}${lastBackup === today ? '（今天）' : ''}`;
  }

  // 方案 A 决策：今天是否应触发自动下载备份。
  // off / 无数据 → 否；从未下载或历史日期损坏(gap==null) → 是；
  // daily 当天已下过(gap<=0) → 否；weekly 不足 7 天(gap<7) → 否。
  // backup 对象缺失时按默认 daily + 从未下载处理（与 migrateState 兑底一致）
  function shouldAutoBackup(s, today) {
    const b = (s && s.backup) || {};
    if (b.autoFreq === 'off' || !hasAnyBackupWorthyData(s)) return false;
    const gap = b.lastAutoDownload ? daysBetweenStr(b.lastAutoDownload, today) : null;
    if (gap == null) return true;
    return b.autoFreq === 'daily' ? gap > 0 : gap >= 7;
  }

  // 方案 C 决策：返回超期天数（严格大于 BACKUP_STALE_DAYS），无需提醒返回 null。
  // 无数据 / 从未备份 / 历史日期损坏均返回 null —— 从未备份时首次自动下载马上会补上，不叠加打扰
  function backupStaleDays(s, today) {
    if (!hasAnyBackupWorthyData(s)) return null;
    const last = s && s.backup && s.backup.lastBackup;
    if (!last) return null;
    const gap = daysBetweenStr(last, today);
    return gap != null && gap > BACKUP_STALE_DAYS ? gap : null;
  }

  // ========== 汇率刷新提示决策 ==========
  // 拉取失败时的便条文案与类型：有缓存可回退 → info「使用缓存汇率」（中性金墨边注，注意但不报警）；
  // 连缓存都没有 → error「汇率获取失败」（报警红）。fetchRates 的 catch 只做 DOM 副作用，
  // 分支决策抽在此保持纯净可测
  function rateFallbackNotice(hasCache) {
    return hasCache
      ? { msg: '使用缓存汇率', type: 'info' }
      : { msg: '汇率获取失败', type: 'error' };
  }

  return {
    toCNY, formatCNY, money2,
    addMonths, getCurrentMonth, getLocalDateStr, getLocalMonthStr, monthLabel,
    daysBetweenStr,
    BACKUP_STALE_DAYS, normalizeBackupFreq, backupNoteText, hasAnyBackupWorthyData, shouldAutoBackup, backupStaleDays,
    rateFallbackNotice,
    nextSortState, expenseMonths,
    findMonthSnapshot, getPrevSnapshot,
    monthlyExpenseTotals, prevExpenseMonthOf, expenseMoM, expenseMonthTagTotals,
    getAssetRate, getSafetyFactor, getCashRatio, calcAssetIncome, hasAnyRatedAsset, cashRatioPct,
    migrateState,
    esc, escRegExp, highlightMatch, moneyStr, jsAttr,
    truncateLabel,
    hexToRgba, hexToHsl, hslToHex, pillColors, basePill,
    CATEGORY_PALETTE, buildSunburstData, pctStr, percentSeriesData, pruneLegendSelected, amountAtRates,
  };
});
