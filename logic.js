/*
 * logic.js — 与 DOM 无关的纯逻辑（UMD：浏览器挂全局 / Node require），页面与单测共用同一份源码。
 * 依赖全局 state / incomeMode 的函数在测试中经 globalThis 注入，签名不变。
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
  // ========== 多语言（i18n）==========
  // 词条键就是中文原文：源文案即键，英文表只管翻译。缺词条时回落中文（不抛错、不显示键名），
  // 覆盖率由 test/ui-wiring.test.js 逐条把守——漏译会让页面中英混排，这比缺功能更难被用户说清。
  // 语言是**用户设置**（state.lang，落盘随存档走）；默认英文。
  const I18N_LANGS = ['en', 'zh'];
  const I18N_DEFAULT = 'en';

  function normalizeLang(v) {
    return v === 'zh' ? 'zh' : 'en';
  }

  // <html lang> / 日期控件用的 BCP-47 标签（语言代码 ≠ 地区代码，两者别混用）
  function langTag(lang) {
    return normalizeLang(lang) === 'zh' ? 'zh-CN' : 'en';
  }

  function flatpickrLocale(l10ns, lang) {
    const table = l10ns && typeof l10ns === 'object' ? l10ns : {};
    const base = normalizeLang(lang) === 'zh' ? table.zh : table.default;
    return Object.assign({}, base && typeof base === 'object' ? base : {}, { firstDayOfWeek: 1 });
  }

  // 取词条并插值。vars 里的 {name} 占位符按名替换；值为数组时选单/复数
  // （英文才有单复数，中文词条永远是字符串）。
  // 单复数的计数只认 vars.n（推荐）或 vars.p1（绝大多数计数句的第一个占位符就是数量），
  // 其它占位符（金额、标签名）不参与判定——拿金额当计数会选出错误的复数。
  function t(key, vars) {
    const lang = normalizeLang(typeof state !== 'undefined' && state ? state.lang : I18N_DEFAULT);
    const table = typeof I18N_EN !== 'undefined' ? I18N_EN : {};
    const raw = lang === 'zh' ? key : (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key);
    let str = raw;
    if (Array.isArray(raw)) {
      const count = vars && (vars.n != null ? Number(vars.n) : Number(vars.p1));
      str = count === 1 ? raw[0] : raw[1];
    }
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  }

  // ========== 示例数据（只产数据，不碰 DOM / 不写 state）==========
  // 时间是入参而非 new Date()（否则「6 个月以当月收尾」测不准）；id 生成器由调用方注入。
  const DEMO_RATES = { CNY: 1, HKD: 0.92, USD: 7.24 };

  function demoRates(now) {
    return Object.assign({}, DEMO_RATES, { fetchedAt: now.toISOString() });
  }

  // 最近 n 个月（含当月），升序。用 date.addMonths 走同一条月份算术，
  // 不另写一份「减 i 个月」——月末（31 号）与闰年那两处会各错各的。
  function recentMonths(now, n) {
    const cur = getLocalMonthStr(now);
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(addMonths(cur, -i));
    return out;
  }

  // 资产侧示例：3 个分类 + 7 笔资产 + 6 个月快照；账本取最新一个月。
  // 快照里的资产 id 跨月稳定：快照对比按 id 关联差异，每月换一套 id 就永远对不上。
  function assetDemo(opts) {
    const o = opts || {};
    const now = o.now || new Date();
    const genId = o.genId || (() => String(Math.random()).slice(2));
    const rates = demoRates(now);
    const catAsset = {
      id: genId(), name: t('资产类型'), builtin: false,
      tags: [t('活期现金'), t('定期存款'), t('权益基金'), t('债券基金'), t('银行理财')],
    };
    const catRisk = {
      id: genId(), name: t('风险等级'), builtin: false,
      tags: [t('低风险'), t('中风险'), t('高风险')],
    };
    const categories = o.currencyCat ? [o.currencyCat, catAsset, catRisk] : [catAsset, catRisk];

    const defs = [
      { name: t('招商银行活期'), base: 50000, cur: 'CNY', type: t('活期现金'), risk: t('低风险'), rMin: 0.25, rMax: 0.35, cash: 100 },
      { name: t('工商银行定期'), base: 200000, cur: 'CNY', type: t('定期存款'), risk: t('低风险'), rMin: 1.8, rMax: 2.2, cash: 100 },
      { name: t('沪深300指数'), base: 80000, cur: 'CNY', type: t('权益基金'), risk: t('高风险'), rMin: 5, rMax: 8, cash: 20 },
      { name: t('标普500ETF'), base: 10000, cur: 'USD', type: t('权益基金'), risk: t('高风险'), rMin: 0, rMax: 0, cash: 0 },
      { name: t('纯债基金A'), base: 100000, cur: 'CNY', type: t('债券基金'), risk: t('中风险'), rMin: 3, rMax: 4.5, cash: 100 },
      { name: t('招行理财'), base: 150000, cur: 'CNY', type: t('银行理财'), risk: t('中风险'), rMin: 2.5, rMax: 3.5, cash: 100 },
      { name: t('汇丰香港储蓄'), base: 50000, cur: 'HKD', type: t('活期现金'), risk: t('低风险'), rMin: 0.1, rMax: 0.2, cash: 100 },
    ];
    // 分类 id 是现生成的，标签表必须按**这一组** id 组装（不能读全局 state.categories）
    const tagOf = (d) => ({ currency: d.cur, [catAsset.id]: d.type, [catRisk.id]: d.risk });

    const months = recentMonths(now, 6);
    const notes = [t('初始配置'), t('小幅加仓'), t('市场波动'), t('补仓操作'), t('分红再投'), t('季度调整')];
    const monthlyChanges = [
      [0, 0, 0, 0, 0, 0, 0],
      [3000, 0, 5000, 0, 0, 0, 0],
      [0, 0, -5000, -500, 1000, 0, 0],
      [2000, 0, 8000, 0, 0, 0, 0],
      [0, 0, 3000, 200, 0, 0, 0],
      [3000, 0, -2000, 300, 0, -10000, 0],
    ];
    const marketJitter = [0, 0.02, -0.06, 0.03, 0.01, 0.04];
    // 权益按整幅抖动、债券与理财按三成/两成折算：三类资产的风险量级要能一眼看出来
    const jitterOf = (d, mi) => {
      if (d.type === t('权益基金')) return marketJitter[mi];
      if (d.type === t('债券基金')) return marketJitter[mi] * 0.3;
      if (d.name === t('招行理财')) return marketJitter[mi] * 0.2;
      return 0;
    };

    const assetIds = defs.map(() => genId());
    const snapshots = months.map((month, mi) => {
      const snapAssets = defs.map((d, ai) => {
        let amount = d.base;
        for (let j = 0; j <= mi; j++) amount += monthlyChanges[j][ai];
        amount = Math.round(amount * (1 + jitterOf(d, mi)));
        return {
          id: assetIds[ai], name: d.name, amount, currency: d.cur,
          tags: tagOf(d), expectedRateMin: d.rMin, expectedRateMax: d.rMax, cashRatio: d.cash,
        };
      });
      return {
        month, note: notes[mi],
        totalCNY: sumAmountCNY(snapAssets, rates),
        currencyRates: Object.assign({}, rates),
        assets: snapAssets,
        updatedAt: month + '-15T12:00:00.000Z',
      };
    });
    const latest = snapshots[snapshots.length - 1];
    return {
      rates,
      categories,
      assets: JSON.parse(JSON.stringify(latest.assets)),
      snapshots,
    };
  }

  // 消费侧示例：3 个分类 + 最近 6 个月的消费流水。
  // 月份用相对偏移推（不要用「当月 1 号减 i 个月」的字面量），
  // 日期落在当月天数内（2 月 30 号这类越界日期会静默变成下个月）。
  function expenseDemo(opts) {
    const o = opts || {};
    const now = o.now || new Date();
    const genId = o.genId || (() => String(Math.random()).slice(2));
    const catPay = {
      id: genId(), name: t('支付方式'), builtin: false,
      tags: [t('微信'), t('支付宝'), t('现金'), t('银行卡')],
    };
    const catFreq = {
      id: genId(), name: t('消费频率'), builtin: false,
      tags: [t('日常'), t('偶尔'), t('一次性')],
    };
    // 已有内置「消费类别」就原样沿用；没有才新建（新建的那一刻取当前语言）
    const expenseTypeCat = o.expenseTypeCat || {
      id: 'expense-type', name: t('消费类别'), builtin: false,
      tags: [t('餐饮'), t('交通'), t('购物'), t('住房'), t('娱乐'), t('医疗'), t('教育'), t('其他')],
    };
    const expenseCategories = [expenseTypeCat, catPay, catFreq];

    const seedRows = [
      { note: t('午餐外卖'), amt: 35, type: t('餐饮'), pay: t('微信'), freq: t('日常') },
      { note: t('地铁通勤'), amt: 12, type: t('交通'), pay: t('支付宝'), freq: t('日常') },
      { note: t('超市采购'), amt: 156, type: t('购物'), pay: t('微信'), freq: t('偶尔') },
      { note: t('房租'), amt: 3500, type: t('住房'), pay: t('银行卡'), freq: t('一次性') },
      { note: t('电影票'), amt: 78, type: t('娱乐'), pay: t('支付宝'), freq: t('偶尔') },
      { note: t('药房买药'), amt: 45, type: t('医疗'), pay: t('现金'), freq: t('偶尔') },
      { note: t('网课订阅'), amt: 299, type: t('教育'), pay: t('微信'), freq: t('一次性') },
      { note: t('咖啡'), amt: 28, type: t('餐饮'), pay: t('微信'), freq: t('日常') },
      { note: t('打车'), amt: 42, type: t('交通'), pay: t('支付宝'), freq: t('日常') },
      { note: t('衣服'), amt: 238, type: t('购物'), pay: t('银行卡'), freq: t('偶尔') },
      { note: t('水电费'), amt: 186, type: t('住房'), pay: t('微信'), freq: t('一次性') },
      { note: t('游戏充值'), amt: 68, type: t('娱乐'), pay: t('支付宝'), freq: t('偶尔') },
      { note: t('理发'), amt: 58, type: t('其他'), pay: t('现金'), freq: t('偶尔') },
    ];
    const jitter = [0, 0.05, -0.1, 0.03, 0.08, -0.02];
    const months = recentMonths(now, 6);

    const expenses = [];
    months.forEach((monthStr, mi) => {
      const factor = 1 + jitter[mi];
      const daysInMonth = daysInMonthOf(monthStr);
      seedRows.forEach((s, si) => {
        // 固定支出（房租）与一次性消费每月都在，其余按偏移轮换——让趋势图有起伏但不杂乱
        if (s.type === t('住房') || s.freq === t('一次性') || si % 3 === mi % 3) {
          const day = Math.min(1 + (si * 3 + mi * 5) % 28, daysInMonth);
          expenses.push({
            id: genId(),
            date: monthStr + '-' + String(day).padStart(2, '0'),
            amount: Math.round(s.amt * factor * 100) / 100,
            note: s.note,
            tags: { [expenseTypeCat.id]: s.type, [catPay.id]: s.pay, [catFreq.id]: s.freq },
          });
        }
      });
    });

    return { expenseCategories, expenses };
  }

  // ========== 图表动画参数（节奏系统的一部分）==========
  // ECharts 默认 1000ms 且不认 prefers-reduced-motion，页面必须显式给；midSec 是 --mo-mid 的秒数。
  function chartMotion(midSec, reduceMotion) {
    if (reduceMotion) return { animation: false };
    const ms = Math.round((Number(midSec) || 0.25) * 1000);
    // 缓动跟随全站那一枚：CSS 侧是 cubic-bezier(.22,.61,.36,1)，ECharts 只认命名曲线，
    // cubicOut 是最近似的一条（快出慢收）。两侧不必逐点相同，但必须同向。
    return { animation: true, animationDuration: ms, animationEasing: 'cubicOut' };
  }

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

  // 日期型下拉一律新的在上；调用方传升序还是降序都不影响结果。
  function monthsDesc(months) {
    return [...new Set((months || []).filter(Boolean))].sort().reverse();
  }

  function monthLabel(month) {
    // 手动拆解避免 new Date('YYYY-MM-01') 按 UTC 解析, 西半球时区（UTC-11/-12）会错月/年
    const [y, m] = String(month || '').split('-');
    if (!y || !m) return String(month || '');
    const mi = parseInt(m, 10);
    if (normalizeLang(state.lang) === 'zh') return t('{y}年{m}月', { y: y, m: mi });
    // 英文用月份短名（2026-2 → Feb 2026）：12 个月名不进词条表，交给 Intl 打理
    try {
      return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(Number(y), mi - 1, 1)));
    } catch (e) {
      return y + '-' + String(mi).padStart(2, '0');
    }
  }

  // ========== 排序状态机（纯）==========
  // 三态循环：同列 升序 → 降序 → 取消；换列重置为新列升序。flipSticky 是消费侧首次点击的粘性翻转。
  function nextSortState(by, dir, field, flipSticky) {
    if (by === field) {
      if (flipSticky) return { by, dir: dir === 'asc' ? 'desc' : 'asc' };
      if (dir === 'asc') return { by, dir: 'desc' };
      return { by: '', dir: 'asc' };
    }
    return { by: field, dir: 'asc' };
  }

  // 行内金额编辑的键位语义（单一来源）：主键盘 Enter 仅保存当前项（'commit'）；
  // 小键盘 Enter（key 也是 'Enter'，靠 code === 'NumpadEnter' 区分）与 Tab/Shift+Tab 同义，
  // 保存并跳到下一/上一行（'jump'），方便用小键盘流式录入；Escape 取消（'cancel'）；其余不处理（null）。
  function inlineEditKeyAction(key, code) {
    if (key === 'Escape') return 'cancel';
    if (key === 'Tab') return 'jump';
    if (key === 'Enter') return code === 'NumpadEnter' ? 'jump' : 'commit';
    return null;
  }

  // 行级激活的键位语义：Enter 与 Space 都要响应（WAI-ARIA 惯例）；Tab/Esc/方向键必须放行，否则把人困在原地。
  function activateKeyAction(key) {
    return key === 'Enter' || key === ' ';
  }

  // 排序表头的 aria-sort 口径：只有当前排序列才带方向，其余一律 'none'。
  // 可视的 ▲/▼ 只在排序生效时出现，读屏器却需要一个显式答案：
  // 「现在按哪一列排、朝哪个方向」。aria-sort 只认这四个字面量，故此处收敛为唯一出口。
  function sortAriaSort(by, dir, field) {
    if (!by || by !== field) return 'none';
    return dir === 'desc' ? 'descending' : 'ascending';
  }

  // 排序列头的可访问名：aria-sort 在 role=button 上不可达（AX 树里测不出），真正到达读屏器的是 aria-label——
  // 方向写进去，可见列名留在前面（WCAG 2.5.3）。
  function sortAriaLabel(label, by, dir, field) {
    if (!by || by !== field) return '';
    if (dir !== 'asc' && dir !== 'desc') return ''; // 脏值不误报方向
    return t('{label}，已按{dir}排列', { label: label, dir: t(dir === 'desc' ? '降序' : '升序') });
  }

  // ===== 进入资产页的门槛：长按 + 抄写 =====
  // 给「顺手看一眼」定价，不是权限：指针路径按满 MODE_PRESS_MS，抬闸后抄一句箴言（键盘不付前者）。
  // 阈值/进度/判定都在这里，页面只读——文案报的时长与判定必须同源。
  const MODE_PRESS_MS = 1000;

  // 已按住时长 → 进度比例（0~1，供进度动画取宽度；超时封顶不溢出）
  function modePressProgress(heldMs) {
    return pressProgress(heldMs, MODE_PRESS_MS);
  }

  // 松手时的处置：'enter' = 抬闸（进抄写框）；'hint' = 短击，弹一句「长按多久」的教学。
  // 无有效按住时长（0/负值/NaN）视为没按，不响应
  function modePressDecision(heldMs) {
    const d = pressDecision(heldMs, MODE_PRESS_MS);
    if (d === 'done') return 'enter';
    return d === 'short' ? 'hint' : 'ignore';
  }

  // ===== 长按判定（可传阈值）=====
  // 同一套状态机服务两处：资产入口（门槛高，要拦一下顺手点）与标签胶囊的长按改名
  // （手势动作，按满即编辑）。阈值参数化而不是复制一份——两份阈值早晚不一致，
  // 而这类漂移的表现是「同一手势在两个地方手感不同」，很难查。
  const TAG_PRESS_MS = 600;

  // 阈值归一（脏值退回资产入口那一档）：进度与处置两处共用，绝不产生 NaN/Infinity
  function pressThreshold(threshold) {
    return threshold > 0 && Number.isFinite(threshold) ? threshold : MODE_PRESS_MS;
  }

  // 已按住时长 → 进度比例（0~1）。脏阈值退回资产入口那一档，绝不产生 NaN/Infinity
  function pressProgress(heldMs, threshold) {
    const t = pressThreshold(threshold);
    if (!(heldMs > 0)) return 0;
    return Math.min(1, heldMs / t);
  }

  function pressDecision(heldMs, threshold) {
    const t = pressThreshold(threshold);
    if (!(heldMs > 0)) return 'ignore';
    return heldMs >= t ? 'done' : 'short';
  }

  // 短击提示文案：时长由常量派生，页面不再写一遍。默认取阈值，参数留给单测验两种小数形态
  function modePressHint(ms) {
    const sec = (ms === undefined ? MODE_PRESS_MS : ms) / 1000;
    return t('长按 {sec} 秒进入资产页', { sec: Number.isInteger(sec) ? sec : sec.toFixed(1) });
  }

  // 门槛箴言池：两池各用母语写、互不翻译；句数相等、长度等价、都不含标点（单测把守），否则换语言就换了门槛的价钱。
  const ENTRY_PHRASES = {
    zh: [
      '账面起落皆是暂相',
      '涨跌无常心不随转',
      '今日数字明日尘埃',
      '波动只是噪音',
      '静看潮起潮落',
      '未落袋的都不算钱',
      '一时的涨跌不算账',
      '潮涨潮落不改岸',
      '心静账才清',
      '数只是数',
      '浮盈浮亏皆浮云',
      '看过不会多一分',
      '慢即是快',
      '多看一眼不添一分',
      '不急这一眼',
      '你看到的只是片刻',
      '价格是别人的意见',
      '一天的涨跌不算数',
      '越看越想动手',
      '手一抖就亏了',
      '波动不是损失',
      '账面不是现实',
      '心不动数不摇',
      '时间会替你算',
      '少看一次多睡一会',
      '让潮水自己退去',
      '别跟自己的数字较劲',
      '数字不催人',
      '明日再看仍是你',
      '看不看都在那里',
    ],
    en: [
      'Numbers rise and fall',
      'A price is not a fact',
      'Calm outlasts the swings',
      'Look later not now',
      'Waves pass shore remains',
      'Short moves are noise',
      'Nothing is permanent',
      'One look adds nothing',
      'Slow is steady',
      'Let the numbers wait',
      'Flux is the only law',
      'Gains not taken not real',
      'Silence beats watching',
      'Numbers change nothing',
      'Patience prices itself',
      'Look once then let go',
      'Prices are opinions',
      'One day is not a trend',
      'Watching breeds wanting',
      'The market is not you',
      'Nothing to do today',
      'Rest beats watching',
      'A dip is not a loss',
      'Paper is not real',
      'Let time do the math',
      'Sleep more look less',
      'The tide has its hours',
      'Do not fight the number',
      'Numbers are in no hurry',
      'Still here tomorrow',
    ],
  };

  // 取一句箴言：按界面语言选池，池子缺失/为空时回落到中文池——空手放行比缺翻译更糟。
  // rng 可注入（单测不赌随机）；脏值一律夹回池内，绝不返回 undefined（那会被
  // 比对函数当成「原句为空」，于是每次都被驳回，门永远打不开）。
  function entryPhrase(lang, rng) {
    const pool = Array.isArray(ENTRY_PHRASES[lang]) && ENTRY_PHRASES[lang].length
      ? ENTRY_PHRASES[lang]
      : ENTRY_PHRASES.zh;
    const raw = typeof rng === 'function' ? Number(rng()) : Math.random();
    const r = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
    return pool[Math.floor(r * pool.length)];
  }

  // 抄写比对：忽略首尾空白与英文大小写，其余（字序、字数、中间空格、标点）必须一致。
  // 不做「去所有空白/去标点」的归一：那等于允许只抄骨架，而门槛的全部意义是让人
  // 把整句读完。原句为空也判不通过——不能因为取句失败就白放人进去。
  function entryPhraseMatches(input, phrase) {
    if (typeof input !== 'string' || typeof phrase !== 'string') return false;
    const want = phrase.trim().toLowerCase();
    if (want === '') return false;
    return input.trim().toLowerCase() === want;
  }

  // ===== 翻页的方向（Tab / 模式切换的入场方向）=====
  // 目标按钮在旧按钮右侧 → 1（内容自右滑入），左侧 → -1；相同或位置取不到 → 0（只淡入）。
  // 为什么用实测位置而不是维护一张「Tab 次序表」：次序表是第二份真相——加一个 Tab 忘改它
  // 就静默漂移；offsetLeft 由浏览器给出，换窗口宽度后方向自动仍正确。
  function paneEnterShift(fromX, toX) {
    if (!Number.isFinite(fromX) || !Number.isFinite(toX)) return 0;
    if (toX > fromX) return 1;
    if (toX < fromX) return -1;
    return 0;
  }

  // ===== 台灯掠光（跟随指针的纸面光，全站唯一的常驻动效）=====
  // 物理隐喻：账本摊在桌上，台灯在纸上游走——换一个指针位置就等于换一个光源位置。
  // 位置换算与「是否该亮」的判定收在这里：CSS 只认两个百分比变量，
  // 页面里不再算一遍（resize 后重新推算是页面的事，不是判定的事）。

  // 指针坐标 → 视口百分比。越界夹在 0~100（指针在窗口外时不该把光晕送出纸面）；
  // 尺寸未知/坐标非法一律给 50（居中兜底）—— NaN% 会让整条 radial-gradient 失效，
  // 表现为「灯忽然坏了」而非报错。
  function lampPos(x, y, w, h) {
    const pct = (v, size) => {
      if (!(size > 0) || !Number.isFinite(v)) return 50;
      return Math.round(Math.min(100, Math.max(0, (v / size) * 100)) * 100) / 100;
    };
    return { x: pct(x, w), y: pct(y, h) };
  }

  // 悬停气泡的视口坐标：气泡用 fixed 挂在视口上——祖先有 backdrop-filter 会自成层叠上下文，后面的卡片能整块盖住它，
  // 弹窗正文的 overflow 也会裁掉。三条约束：默认下方左对齐、下方放不下翻上、右侧放不下向左收（始终夹在视口内）。
  const TIP_GAP = 8;   // 锚点与气泡之间的间距
  const TIP_EDGE = 8;  // 气泡与视口边缘的最小留白
  function tipBubblePos(anchor, bw, bh, viewport) {
    const num = (v, dflt) => (Number.isFinite(v) ? v : dflt);
    const a = anchor || {};
    const vw = num(viewport && viewport.w, 0);
    const vh = num(viewport && viewport.h, 0);
    const width = Math.max(0, num(bw, 0));
    const height = Math.max(0, num(bh, 0));
    const left0 = num(a.left, TIP_EDGE);
    const top0 = num(a.top, TIP_EDGE);
    const bottom0 = num(a.bottom, top0);
    // 横向：与锚点左对齐，右侧放不下就向左收；比视口还宽时贴左边缘
    let left = left0;
    if (vw > 0 && left + width > vw - TIP_EDGE) left = vw - TIP_EDGE - width;
    if (left < TIP_EDGE) left = TIP_EDGE;
    // 纵向：优先下方；下方放不下且上方更宽裕就翻上去
    let top = bottom0 + TIP_GAP;
    if (vh > 0 && top + height > vh - TIP_EDGE) {
      const above = top0 - TIP_GAP - height;
      top = above >= TIP_EDGE ? above : Math.max(TIP_EDGE, vh - TIP_EDGE - height);
    }
    return { left: Math.round(left), top: Math.round(top) };
  }

  // 灯该不该亮：减动效 / 触屏 / 页面不可见 / 弹窗开着，四种都不跟（弹窗开着时光在磨砂后面白算）。
  function lampEnabled(opts) {
    const o = opts || {};
    return !o.reducedMotion && !o.coarsePointer && !o.hidden && !o.modalOpen;
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

  // 快照对比默认基准：取次新（倒数第二）快照月，与最新月构成「最近两个月」对比。
  // sorted: 按 month 升序的快照数组；不足两个快照返回 null（openCompareModal 已守卫 >=2）
  function defaultCompareBaseMonth(sorted) {
    const list = sorted || [];
    return list.length >= 2 ? list[list.length - 2].month : null;
  }

  // ========== 月度快照提醒（纯决策）==========
  // 快照是**某个月的资产事实**：只提醒当月，绝不催促补记历史月份（补记只能拿今天的数贴上一个月的标签）。
  // 提醒只是通知，不跳转、不带入口按钮——门槛（DECISIONS.md）保护的是「看数字」，提醒不替用户省这笔钱。
  const SNAPSHOT_REMINDER_DEFAULT_DAYS = 5;
  const SNAPSHOT_REMINDER_MAX_DAYS = 28; // 2 月只有 28 天，「月末前 30 天」等于整月

  function normalizeSnapshotReminder(v) {
    const o = v && typeof v === 'object' ? v : {};
    const win = ['off', 'start', 'end'].includes(o.window) ? o.window : 'end';
    const n = Math.round(Number(o.days));
    const days = Number.isFinite(n)
      ? Math.min(SNAPSHOT_REMINDER_MAX_DAYS, Math.max(1, n))
      : SNAPSHOT_REMINDER_DEFAULT_DAYS;
    return { window: win, days };
  }

  // 今天是否落在提醒窗口内。窗口按**当月实际天数**算：「月末前 N 天」= 距月末不足 N 天，
  // 「月初后 N 天」= 日号大于 N。两个模式二选一：并集在 31 天的月里能连成整月，解释不了「为什么天天弹」。
  function snapshotReminderInWindow(reminder, today) {
    const r = normalizeSnapshotReminder(reminder);
    if (r.window === 'off') return false;
    const day = Number(String(today || '').split('-')[2]);
    const dim = daysInMonthOf(String(today || '').slice(0, 7));
    if (!day || !dim) return false; // 脏日期不弹（不猜，也不当作「窗口内」）
    return r.window === 'start' ? day > r.days : dim - day < r.days;
  }

  // 今天该不该弹：窗口内 ∧ 有资产 ∧ 本月还没快照 ∧ 今天还没提醒过。
  // 无资产不催：快照会是一张全 0 的表，提醒只会教人忽视提醒。
  // 节流痕迹只有 lastPrompted：用户没记就明天再问（与备份「取消=没发生过」同一种耐心，一个月一档、一天一档）。
  function shouldRemindSnapshot(s, today) {
    s = s || {};
    const r = normalizeSnapshotReminder(s.snapshotReminder);
    if (r.window === 'off') return false;
    if ((s.assets || []).length === 0) return false;
    const month = String(today || '').slice(0, 7);
    if ((s.snapshots || []).some(x => x && x.month === month)) return false;
    if (s.snapshotReminderLastPrompted === today) return false;
    return snapshotReminderInWindow(r, today);
  }

  // 提醒文案：报最近一次快照月份（月份不是金额，不泄露资产数值），让「欠了多久」自明。
  // 标题是静态文案（data-i18n="快照提醒"），这里只产正文。
  function snapshotReminderText(s) {
    const months = ((s && s.snapshots) || []).map(x => x && x.month).filter(Boolean).sort();
    const last = months.length ? monthLabel(months[months.length - 1]) : null;
    return {
      msg: last
        ? t('本月快照还没记。上次快照：{p1}。在「资产 → 历史净值」记录本月快照，净值曲线才连得上。', { p1: last })
        : t('本月快照还没记。还没有任何月度快照。在「资产 → 历史净值」记录本月快照，净值曲线才连得上。'),
    };
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

  // ========== 消费标签筛选（分组下拉，纯函数）==========
  // 类别作 optgroup 头；选中值编码 catId + \u0001 + tag，DOM 侧不自行拼/拆（防两处漂移）。
  const TAG_FILTER_SEP = '\u0001';

  function tagFilterValue(catId, tag) {
    return String(catId == null ? '' : catId) + TAG_FILTER_SEP + String(tag == null ? '' : tag);
  }

  function parseTagFilter(value) {
    const v = String(value == null ? '' : value);
    const i = v.indexOf(TAG_FILTER_SEP);
    if (i <= 0) return null;
    const tag = v.slice(i + 1);
    if (!tag) return null;
    return { catId: v.slice(0, i), tag: tag };
  }

  function expenseTagFilterGroups(categories) {
    return (categories || []).map(c => ({
      id: c.id,
      name: c.name,
      tags: ((c || {}).tags || []).slice(),
    }));
  }

  function hasTagFilterOption(groups, value) {
    const p = parseTagFilter(value);
    if (!p) return false;
    return (groups || []).some(g => g.id === p.catId && ((g || {}).tags || []).indexOf(p.tag) >= 0);
  }

  // ========== 消费筛选（三段叠加 + 空态判据，唯一所有者）==========
  // 控件只写、渲染只读这一份状态；失效值在归一阶段丢弃，所以不存在「先重建下拉、再读值」的次序依赖。
  function normalizeExpenseFilters(filters, expenses, categories) {
    const f = filters || {};
    const months = expenseMonths(expenses);
    const groups = expenseTagFilterGroups(categories);
    return {
      month: f.month && months.indexOf(f.month) >= 0 ? f.month : '',
      tag: f.tag && hasTagFilterOption(groups, f.tag) ? f.tag : '',
      query: f.query == null ? '' : String(f.query),
    };
  }

  // 关键词命中口径：备注 / 日期 / 分类名 / 标签值（调用方传已小写化的 q）
  function matchesExpenseQuery(item, q, categories) {
    if ((item.note || '').toLowerCase().indexOf(q) >= 0) return true;
    if ((item.date || '').indexOf(q) >= 0) return true;
    return (categories || []).some(cat => {
      const tv = item.tags && item.tags[cat.id];
      return tv ? cat.name.toLowerCase().indexOf(q) >= 0 || String(tv).toLowerCase().indexOf(q) >= 0 : false;
    });
  }

  function applyExpenseFilters(expenses, filters, categories) {
    const f = filters || {};
    const q = String(f.query == null ? '' : f.query).trim().toLowerCase();
    const parsed = f.tag ? parseTagFilter(f.tag) : null;
    return (expenses || []).filter(e => {
      if (f.month && (e.date || '').slice(0, 7) !== f.month) return false;
      if (parsed && (!e.tags || e.tags[parsed.catId] !== parsed.tag)) return false;
      if (q && !matchesExpenseQuery(e, q, categories)) return false;
      return true;
    });
  }

  // 列表视图：结果、生效维度、空态判据都从同一份（已归一的）输入派生
  // emptyKind: null=有结果 / 'no-data'=一条记录都没有 / 'no-match'=有数据但筛不出
  function expenseListView(expenses, filters, categories) {
    const normalized = normalizeExpenseFilters(filters, expenses, categories);
    const rows = applyExpenseFilters(expenses, normalized, categories);
    const parsed = normalized.tag ? parseTagFilter(normalized.tag) : null;
    const query = normalized.query.trim();
    const active = { month: normalized.month, tag: parsed ? parsed.tag : '', query: query };
    return {
      rows: rows,
      active: active,
      hasFilter: !!(active.month || active.tag || query),
      emptyKind: rows.length ? null : ((expenses || []).length ? 'no-match' : 'no-data'),
    };
  }

  // ========== 消费数据校验（缺标签补齐）==========
  // 「未归类」三态：key 缺失 / 空值 / 指向已删除标签的陈旧引用——三种都进不了分组统计
  function isUntaggedItem(item, catId, validTags) {
    const v = item && item.tags ? item.tags[catId] : '';
    return !v || (validTags || []).indexOf(v) < 0;
  }

  // 按分类分组列出未归类记录（显式收参不偷读全局）；内置/无标签分类跳过，无缺口的分组不返回
  function missingTagGroups(items, categories) {
    return (categories || [])
      .filter(c => c && !c.builtin && ((c || {}).tags || []).length)
      .map(c => ({
        catId: c.id,
        name: c.name,
        tags: c.tags.slice(),
        items: (items || []).filter(e => isUntaggedItem(e, c.id, c.tags)),
      }))
      .filter(g => g.items.length > 0);
  }

  // 写标签的唯一入口：补建 tags 对象后落值（一键批量与逐条点选都经这里，面板不直接赋值）
  function setTag(item, catId, tag) {
    if (!item) return;
    if (!item.tags || typeof item.tags !== 'object') item.tags = {};
    item.tags[catId] = tag;
  }

  // 一键补齐：只写空缺/陈旧位，绝不覆盖已归类的值；返回实际补齐条数
  function backfillTag(items, catId, tag, validTags) {
    let n = 0;
    (items || []).forEach(it => {
      if (!it || !isUntaggedItem(it, catId, validTags)) return;
      setTag(it, catId, tag);
      n++;
    });
    return n;
  }

  // ========== 标签改名的引用迁移 ===========
  // 改名必须迁移引用：按「旧名已失效」清理会静默清空归类（分布/收益随之失真）。返回迁移条数供 UI 提示。
  function migrateTagRefs(items, catId, from, to) {
    let n = 0;
    (items || []).forEach(it => {
      if (!it || !it.tags || typeof it.tags !== 'object') return;
      if (it.tags[catId] !== from) return;
      it.tags[catId] = to;
      n++;
    });
    return n;
  }

  // 读数卡所选标签同样按「分类 + 名字」引用，改名须一并迁移，否则 pruneRunwayTags
  // 会把用户选好的标签当成陈旧引用清掉（选择凭空消失）。不改入参，返回新数组。
  function migrateRunwayTagRefs(runwayTags, catId, from, to) {
    return (runwayTags || []).map(r =>
      r && r.catId === catId && r.tag === from ? { catId: r.catId, tag: to } : r);
  }

  // 统计有多少条记录引用了这些（即将被移除的）标签值：删除标签前告知用户的单一来源
  function countTagRefs(items, catId, tagValues) {
    const set = new Set(tagValues || []);
    return (items || []).filter(it => it && it.tags && set.has(it.tags[catId])).length;
  }

  // ========== 分类标签输入（逗号分隔）==========
  // 分类编辑框里的「标签（逗号分隔）」→ 标签数组：中英文逗号都认、去空白、去空项、去重保序。
  // 去重就在这里做：重复项在列表里是两枚同名胶囊、在图表里是两份同名分组，
  // 而改名判重（includes）会被其中一个挡住——留着也不会被清掉。
  function normalizeTagArray(v) {
    const out = [];
    const seen = new Set();
    (Array.isArray(v) ? v : []).forEach(t => {
      const s = typeof t === 'string' ? t.trim() : '';
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    });
    return out;
  }

  // 存档里的 tags 数组与编辑框里的输入是同一个形状，解析只此一处（页面不得再写一份 split）
  function parseTagInput(raw) {
    return normalizeTagArray(String(raw == null ? '' : raw).split(/[,，]/));
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
  // 「没设」有四种写法：缺失 / null / '' / 其它非法值——四者同义（→100%）。
  // 注意不能直接 Number()：Number(null) 与 Number('') 都是 0，会把「没设」算成「0% 现金」（纯权益），
  // 与缺失默认 100% 正好相反。0 本身是合法值，必须保住。
  function getCashRatio(a) {
    const raw = a && a.cashRatio;
    if (raw == null || raw === '') return 1;
    const r = Number(raw);
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

  // ========== 覆盖标尺（月收益对预期月消费的覆盖率）==========
  // 分母未设/非法 → null（UI 走邀请态）；分子非法/负数 → 0。形参名 amount 与口径无关。
  function coveragePct(amount, expectation) {
    const e = Number(expectation);
    if (!isFinite(e) || e <= 0) return null;
    const c = Number(amount);
    if (!isFinite(c) || c < 0) return 0;
    return c / e * 100;
  }

  // 两口径收益合计（报头副行/收益摘要/覆盖标尺共用）：未设利率的资产贡献 0，空表不产出 NaN。
  // 语义：全量累加含负收益资产——旧实现 filter(annual>0) 剔除负值属口径分裂，勿回潮。
  function sumAssetIncomes(assets) {
    let annual = 0, cashAnnual = 0;
    (assets || []).forEach(a => {
      const inc = calcAssetIncome(a);
      annual += inc.annual;
      cashAnnual += inc.cashAnnual;
    });
    return { annual, cashAnnual, monthly: annual / 12, daily: annual / 365, cashMonthly: cashAnnual / 12 };
  }

  // 收益−预期差额口径（覆盖标尺读数单一来源; 报头不再重复渲染差额, 防盈余/缺口金额两处各算漂移）。
  // 返回 { ok, word, amt, pct }: ok=gap>=0（打平算盈余）; amt=差额取整; pct=差额占预期百分比。
  // expectation 未设/非法 → null（调用方回退邀请态/空后缀）; amount 非法按 0 参与差额不产出 NaN
  function incomeGap(amount, expectation) {
    const e = Number(expectation);
    if (!isFinite(e) || e <= 0) return null;
    const a = Number(amount);
    const gap = (isFinite(a) ? a : 0) - e;
    return {
      ok: gap >= 0,
      word: gap >= 0 ? t('盈余') : t('缺口'),
      amt: Math.round(Math.abs(gap)),
      pct: Math.abs(gap) / e * 100,
    };
  }

  // 有息本金（CNY）: 设了预期利率（当前 incomeMode 档）的资产按当前汇率折算合计 ——
  // 外推「还需多少本金」的收益率基地；零利率资产不摊薄收益率（与页脚加权平均利率同基地），
  // 否则把闲置现金算进基地会得出偏低的年化、进而算出偏高的所需本金。空表/缺失入参归 0。
  function ratedPrincipalCNY(assets) {
    return (assets || []).reduce((s, a) => {
      if (!(getAssetRate(a) > 0)) return s;
      return s + toCNY(Number(a.amount) || 0, a.currency);
    }, 0);
  }

  // 还需本金（线性外推）：缺口月 ×12 ÷ 实际年化，实际年化 = annual ÷ principal（分母只含有息本金）。
  // 返回 { need, rate }，两者同源一次算出——展示层再算一遍就会与外推基数分家。
  function coverShortfallPrincipal(monthly, expectation, annual, principal) {
    const e = Number(expectation);
    if (!isFinite(e) || e <= 0) return { need: null, rate: 0 };
    const m = Number(monthly);
    const gap = e - (isFinite(m) ? m : 0);
    if (gap <= 0) return { need: null, rate: 0 };
    const a = Number(annual);
    const p = Number(principal);
    const valid = isFinite(a) && isFinite(p) && p > 0;
    const rate = valid ? a / p * 100 : 0;
    if (!valid || a <= 0) return { need: Infinity, rate };
    return { need: gap * 12 * p / a, rate };
  }

  // ========== 所选标签的钱 ÷ 预期月消费（消费趋势的读数卡，与收益测算无关）==========
  // 口径与收益无关: 分子是本金（所选标签匹配的资产按当前汇率折算）, 不乘安全边际、不看利率。
  // 标签引用形如 { catId, tag }, 与 assets[].tags[catId] === tag 匹配。

  // 标签引用归一/清理: 丢弃畸形项与指向已不存在分类/标签的引用, 去重保序。
  // migrateState（迁移/导入）与分类 CRUD（改名/删除标签）共用同一口径, 避免读数指着悬空标签。
  // 消费分类与读数卡无关, 由调用方按侧别（asset）决定是否清理。
  function pruneRunwayTags(runwayTags, categories) {
    if (!Array.isArray(runwayTags)) return [];
    const cats = Array.isArray(categories) ? categories : [];
    const seen = new Set();
    const out = [];
    runwayTags.forEach(ref => {
      if (!ref || typeof ref !== 'object') return;
      const { catId, tag } = ref;
      if (typeof catId !== 'string' || typeof tag !== 'string') return;
      const cat = cats.find(c => c && c.id === catId);
      if (!cat || !Array.isArray(cat.tags) || !cat.tags.includes(tag)) return;
      const key = catId + '\u0001' + tag;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ catId, tag });
    });
    return out;
  }

  // 分子合计（CNY）：匹配资产的金额按当前汇率折算求和。同分类内多选取「或」、跨分类取「且」；
  // 未选标签返回 null（与「选了但没命中」的 0 区分），UI 据此走指引句。
  function runwayLiquidCNY(assets, runwayTags) {
    const refs = Array.isArray(runwayTags) ? runwayTags : [];
    if (refs.length === 0) return null;
    const groups = new Map();
    refs.forEach(ref => {
      // catId 与 tag 都必须是字符串: 缺 tag 时会把 undefined 塞进集合, 而
      // 「没打过该分类标签」的资产 a.tags[catId] 恰为 undefined → 被误判为命中（分子虚高）
      if (!ref || typeof ref.catId !== 'string' || typeof ref.tag !== 'string') return;
      if (!groups.has(ref.catId)) groups.set(ref.catId, new Set());
      groups.get(ref.catId).add(ref.tag);
    });
    if (groups.size === 0) return null;
    let sum = 0;
    (assets || []).forEach(a => {
      if (!a || !a.tags) return;
      let hit = true;
      for (const [catId, tags] of groups) {
        if (!tags.has(a.tags[catId])) { hit = false; break; }
      }
      if (hit) sum += toCNY(a.amount, a.currency);
    });
    return sum;
  }

  // 分母（月消费）：全局预期未设 → 整卡不显示；已设则自定值优先。自定值只作用于本卡，不写回全局口径。
  function runwayExpectationOf(runwayExpectation, expenseExpectation) {
    const global = Number(expenseExpectation);
    if (!isFinite(global) || global <= 0) return 0;
    const custom = Number(runwayExpectation);
    return isFinite(custom) && custom > 0 ? custom : global;
  }

  // 分母是否为自定值（与 runwayExpectationOf 同一判定）: 读数卡据此把分母名换成「月消费（自定）」。
  // 若不换名, 自定的分母会和旁边的覆盖标尺/进度卡（仍是全局预期）看着像同一个数。
  function runwayExpectationIsCustom(runwayExpectation) {
    const custom = Number(runwayExpectation);
    return isFinite(custom) && custom > 0;
  }

  // 输入串 → 自定月消费（0 = 按默认）：空/非法/非正 → 0；与全局相同的数也存 0（否则日后改全局时本卡会钉住旧值）。
  // 写入侧与弹窗预览共用这一处——各写一份时值恰好等价也会分家且不报错。
  function normalizeRunwayExpectationInput(raw, expenseExpectation) {
    const v = parseMoneyInput(raw);
    if (!isFinite(v) || v <= 0) return 0;
    const global = Number(expenseExpectation);
    if (isFinite(global) && global > 0 && v === global) return 0;
    return v;
  }

  // 月数 = 分子 ÷ 月消费（分母为自定或全局预期, 取法见 runwayExpectationOf）;
  // 分母未设/非法或分子未选（null）→ null（UI 不渲染读数）
  function runwayMonths(liquidCNY, expectation) {
    const exp = Number(expectation);
    const liq = Number(liquidCNY);
    if (liquidCNY == null || !isFinite(liq) || !isFinite(exp) || exp <= 0) return null;
    return liq / exp;
  }

  // 月数展示: 一律整数月（小数直接舍弃，不四舍五入也不进位）—— 「能撑多久」的保守口径，宁可少报不虚报；
  // 不足一个月单独成句（否则只能显示「0 个月」）。一年以上拆成「x 年 x 月」，余数为 0 只写年。
  function runwayMonthsText(months) {
    const m = Number(months);
    if (months == null || !isFinite(m)) return '';
    if (m < 1) return t('不足 1 个月');
    const whole = Math.floor(m);
    if (whole < 12) return t('{n} 个月', { n: whole });
    const years = Math.floor(whole / 12);
    const rem = whole - years * 12;
    return rem === 0 ? t('{y} 年', { y: years }) : t('{y} 年 {m} 个月', { y: years, m: rem });
  }

  // ========== 压测（全局视图叠加：某维度下各标签还剩多少）==========
  // 决策见 DECISIONS.md。keep 是剩余比例（不是跌幅），只存比例不存金额；
  // 单维度是硬约束——两个维度会把同一笔钱乘两次（剩 50% 与 90% 变成 45%）。

  // 剩余比例归一：非有限数 → null（该条丢弃，不是当成 100——「没填」和「填了个乱码」不是一回事）；
  // 越界钳制 0~100（>100% 是「看涨」，本页不做预测）；小数四舍五入成整数（滑块就是 step=1）。
  function normalizeKeepPct(raw) {
    if (raw == null || raw === '') return null;
    const v = Number(raw);
    if (!isFinite(v)) return null;
    return Math.min(100, Math.max(0, Math.round(v)));
  }

  // 一条情景条目的剩余比例：新格式读 keep；旧格式（跌幅语义的 pct）取补数 100-pct。
  // 旧格式是本次改语义之前的存档（pct: 0 = 没跌 = 剩 100%），迁移只此一处。
  function keepOfEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.keep != null) return normalizeKeepPct(entry.keep);
    if (entry.pct != null) {
      const pct = normalizeKeepPct(entry.pct);
      return pct == null ? null : 100 - pct;
    }
    return null;
  }

  // 情景归一（加载与导入共用）：非法 / 指向已删标签 / 选了内置货币分类 / 剪完全是 100% → null，不弹提示。
  // categories 为空只做形状归一——「读不到分类」≠「分类已删」，失败即未知。
  function pruneStress(stress, categories) {
    if (!stress || typeof stress !== 'object' || Array.isArray(stress)) return null;
    const catId = typeof stress.catId === 'string' ? stress.catId : '';
    if (!catId) return null;
    const cats = Array.isArray(categories) ? categories : null;
    // 内置分类（货币类型）不参与压测：汇率已经是一条真实在变的通道，
    // 把它塞进「压测」会让人分不清哪一半是假设（与资产列表不重复展示货币 pill 同一处置）。
    const cat = cats ? cats.find(c => c && c.id === catId) : null;
    if (cats) {
      if (!cat || cat.builtin) return null;
    }
    // 新格式 keeps 优先；旧格式 drops（跌幅语义）走同一归一（keepOfEntry 里转补数）
    const raw = Array.isArray(stress.keeps) ? stress.keeps
      : (Array.isArray(stress.drops) ? stress.drops : []);
    const validTags = new Set((cat && Array.isArray(cat.tags) ? cat.tags : []) || []);
    const seen = new Set();
    const keeps = [];
    raw.forEach(d => {
      if (!d || typeof d !== 'object') return;
      const tag = typeof d.tag === 'string' ? d.tag : '';
      if (!tag || seen.has(tag)) return;
      if (cat && !validTags.has(tag)) return;
      const keep = keepOfEntry(d);
      if (keep == null) return;
      seen.add(tag);
      keeps.push({ tag, keep });
    });
    if (keeps.length === 0) return null;
    // 全是「剩 100%」= 未启用，不留空壳在存档里（与 stressActive 同一判定）
    if (!keeps.some(d => d.keep < 100)) return null;
    return { catId, keeps };
  }

  // 情景是否生效: 有维度且至少一个标签「不是剩满」。剩满 = 没亏 = 未启用
  //（条回到未启用、读数回真实值）。
  function stressActive(stress) {
    if (!stress || typeof stress !== 'object') return false;
    if (typeof stress.catId !== 'string' || !stress.catId) return false;
    return (Array.isArray(stress.keeps) ? stress.keeps : [])
      .some(d => d && Number(d.keep) < 100);
  }

  // 该资产在本情景下的**剩余比例（%）**：未命中标签 / 未归类 / 情景非法 → 100（不打折）。
  // 未归类恒为 100 是有意的：静默给它编一个比例等于替用户假设，条上会把「未归类 ¥X」报出来。
  function stressKeepOf(asset, stress) {
    if (!asset || !stressActive(stress)) return 100;
    const tagVal = asset.tags ? asset.tags[stress.catId] : undefined;
    if (typeof tagVal !== 'string' || !tagVal) return 100;
    const hit = (stress.keeps || []).find(d => d && d.tag === tagVal);
    if (!hit) return 100;
    const keep = Number(hit.keep);
    return isFinite(keep) ? Math.min(100, Math.max(0, keep)) : 100;
  }

  // 该资产在本情景下的跌幅（%）= 100 − 剩余：只在展示层用（条上的「-X%」）。
  // 存储用 keep、展示用 drop，换算是**单一来源**（别在页面里再写一遍 100-keep）。
  function stressDropOf(asset, stress) {
    return 100 - stressKeepOf(asset, stress);
  }

  // 折算后的资产（**全局视图叠加的唯一入口**）：未启用时原样返回同一份数组（零开销），
  // 启用时返回 {...a, amount: 折算后}——利率是收益率不是金额，收益在 calcAssetIncome 里自然跟着缩。
  function effectiveAssets(assets, stress) {
    if (!stressActive(stress)) return assets;
    return (assets || []).map(a => {
      if (!a || typeof a !== 'object') return a;
      const keep = stressKeepOf(a, stress);
      if (keep >= 100) return a;
      const amount = Number(a.amount) || 0;
      return { ...a, amount: amount * (keep / 100) };
    });
  }

  // 条上的那句话（资产侧常驻条的唯一文案出口）——下沉到 logic.js 是为了**可单测**：
  // 三态（无可用维度 / 未启用 / 生效）各自的文案与「未归类」那句尾巴都在这里，
  // 页面只负责把它写进 DOM。分类名与标签名是账本内容，不翻译；其余经 t()。
  // 生效时列出的是**剩余比例**（与滑块上的数一致：用户刚拉的就是它，再换一个数给他等于要他换算）。
  function stressBarText(stress, categories, assets) {
    if (stressDimensions(categories).length === 0) return t('压测：先在「分类管理」里建一个分类');
    if (!stressActive(stress)) return t('压测：未启用');
    const cat = stressDimensions(categories).find(c => c.id === stress.catId);
    const parts = (stress.keeps || [])
      .filter(d => d && Number(d.keep) < 100)
      .map(d => d.tag + ' ' + d.keep + '%');
    const un = unclassifiedCNY(assets, stress, categories);
    const unText = un.count > 0
      ? t(' · 未归类 {p1} 按未打折计入', { p1: formatCNY(un.cny) })
      : '';
    return t('压测中：{p1}', { p1: (cat ? cat.name + '：' : '') + parts.join(' · ') }) + unText;
  }

  // 可压测的维度：排除内置分类（货币类型 —— 汇率是一条真实在变的通道，
  // 混进来会让人分不清哪一半是假设）。也用于「没有可选维度」这条三态判定。
  function stressDimensions(categories) {
    return (Array.isArray(categories) ? categories : [])
      .filter(c => c && typeof c.id === 'string' && c.id && !c.builtin);
  }

  // 弹窗里逐标签一行的数据（标签 / 该标签当前折算金额 / 当前剩余比例）——页面只拼 HTML。
  // 金额口径与分布图一致：命中该维度该标签的资产按当前汇率折算合计。
  // 默认剩满 100%：滑块初始就在最右端，「没亏」这个默认值本身就是最常用的那个。
  function stressKeepRows(assets, stress, categories) {
    const cat = (Array.isArray(categories) ? categories : []).find(c => c && c.id === (stress && stress.catId));
    if (!cat) return [];
    const rates = (typeof state !== 'undefined' && state && state.rates) || { CNY: 1 };
    const keepOf = (tag) => {
      const hit = ((stress && stress.keeps) || []).find(d => d && d.tag === tag);
      if (!hit) return 100;
      const keep = Number(hit.keep);
      return isFinite(keep) ? Math.min(100, Math.max(0, keep)) : 100;
    };
    return (cat.tags || []).map(tag => {
      const amount = (assets || []).reduce((s, a) => {
        if (!a || !a.tags || a.tags[cat.id] !== tag) return s;
        return s + amountAtRates(a.amount, a.currency, rates);
      }, 0);
      return { tag, amount: amount, keep: keepOf(tag) };
    });
  }

  // 该维度下「未归类」资产（缺 key / 空值 / 指向已删标签）的折算合计与条数——条上那句口径说明用。
  // 未启用 / 分类列表读不到 → 全 0（失败即未知，不假装「全部未归类」）。
  // 判据复用 expense.isUntaggedItem 的同一口径（三种失效写法都进不了分组统计）。
  function unclassifiedCNY(assets, stress, categories) {
    const zero = { cny: 0, count: 0 };
    if (!stressActive(stress)) return zero;
    const cats = Array.isArray(categories) ? categories : null;
    const cat = cats && cats.find(c => c && c.id === stress.catId);
    if (!cat) return zero;
    let cny = 0, count = 0;
    (assets || []).forEach(a => {
      if (!a || !isUntaggedItem(a, stress.catId, cat.tags)) return;
      count++;
      cny += amountAtRates(a.amount, a.currency, (typeof state !== 'undefined' && state && state.rates) || { CNY: 1 });
    });
    return { cny, count };
  }

  // 加权平均跌幅（%，报头小字「压测 -Z%」用）: 折算后总额相对原总额的跌幅。
  // 折扣是按每笔资产算的，这个数是它的加权结果——比列出每个标签的剩余短，用户要看的是量级。
  // 空表 / 原总额为 0 → 0（不产出 NaN）。
  function weightedDrop(assets, stress, categories) {
    if (!stressActive(stress)) return 0;
    const rates = (typeof state !== 'undefined' && state && state.rates) || { CNY: 1 };
    let before = 0, after = 0;
    (assets || []).forEach(a => {
      if (!a || typeof a !== 'object') return;
      const orig = amountAtRates(a.amount, a.currency, rates);
      const keep = stressKeepOf(a, stress);
      before += orig;
      after += orig * (keep / 100);
    });
    if (!(before > 0)) return 0;
    return (before - after) / before * 100;
  }

  // 标签改名要迁移情景里的引用（与读数卡同一处置）: 走「旧名已失效」的清理会把设好的比例
  // 静默丢掉，而用户只是改了个名。只迁移恰好命中「同分类 + 同名」的那条；不改入参。
  function migrateStressTagRefs(stress, catId, from, to) {
    if (!stress || typeof stress !== 'object') return stress;
    if (stress.catId !== catId || !Array.isArray(stress.keeps)) return stress;
    return {
      ...stress,
      keeps: stress.keeps.map(d =>
        d && typeof d === 'object' && d.tag === from ? { ...d, tag: to } : d),
    };
  }


  // ========== 本月预算消耗（趋势页进度读数卡）==========
  // 本月合计（CNY）: 复用 monthlyExpenseTotals 同一容错口径（缺 date / NaN 金额贡献 0）, 不另写一套
  function monthExpenseTotal(expenses, month) {
    const found = monthlyExpenseTotals(expenses).find(x => x.month === month);
    return found ? found.total : 0;
  }

  // ========== 记账中断（连续多少天一笔都没有）==========
  // 最后一笔（今天及以前）到今天之间空着的整天数：昨天记过 = 1，今天记过 = 0。
  // 一笔都没有 → null（没记过就谈不上断）。
  const GAP_DAYS_DEFAULT = 3;
  const GAP_DAYS_MAX = 60;

  function gapDays(expenses, todayStr) {
    const today = String(todayStr || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
    let last = '';
    (expenses || []).forEach(e => {
      if (!e) return;
      const d = String(e.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today) return;
      if (d > last) last = d;
    });
    if (!last) return null;
    const diff = daysBetweenStr(last, today);
    return diff == null ? null : Math.max(0, diff - 1);
  }

  // 设置里那个天数：0 = 关闭；缺失/脏值回落默认（旧存档没有这个字段）
  function normalizeGapDays(v) {
    if (v === '' || v == null) return GAP_DAYS_DEFAULT;
    const n = Number(v);
    if (!isFinite(n)) return GAP_DAYS_DEFAULT;
    return Math.min(GAP_DAYS_MAX, Math.max(0, Math.round(n)));
  }

  // 'YYYY-MM' → 当月天数。手动拆解构造 new Date(y, m, 0)（本地时区, 不走 toISOString 的 UTC 偏移）;
  // 年/月非法（含 13 月、0 月）返回 null
  function daysInMonthOf(month) {
    const [y, m] = String(month || '').split('-').map(Number);
    if (!y || !m || m < 1 || m > 12) return null;
    return new Date(y, m, 0).getDate();
  }

  // 本月预算口径：不用时间进度做基准（大额固定支出的入账日决定一切，不携带「花超了」的信息），
  // 只给 remaining / daysLeft / dailyLeft / over / pctOfMonth；预期未设 → null。
  function monthBudgetReading(spent, expectation, today) {
    const e = Number(expectation);
    if (!isFinite(e) || e <= 0) return null;
    const t = today instanceof Date && !isNaN(today) ? today : new Date();
    const days = daysInMonthOf(getLocalMonthStr(t));
    const daysLeft = Math.max(1, days - t.getDate() + 1);
    const s = Number(spent) || 0;
    const over = s > e;
    const remaining = Math.max(0, e - s);
    return {
      daysLeft: daysLeft,
      pctOfMonth: s / e * 100,
      over: over,
      remaining: remaining,
      excess: over ? s - e : 0,
      dailyLeft: remaining / daysLeft,
    };
  }

  // 预算文案（#pace-note 唯一出口）：每个字段先验成有限数，否则 formatCNY(undefined) 抛错、NaN 会渲染成「¥NaN」。
  function monthBudgetNote(reading) {
    if (!reading) return '';
    const remaining = Number(reading.remaining);
    if (!isFinite(remaining)) return '';
    if (reading.over) {
      const excess = Number(reading.excess);
      return isFinite(excess) && excess > 0
        ? t('已超预算 {p1} · 本月额度已用完', { p1: formatCNY(excess) })
        : '';
    }
    if (remaining <= 0) return '';
    const daysLeft = Number(reading.daysLeft);
    const dailyLeft = Number(reading.dailyLeft);
    if (!isFinite(daysLeft) || daysLeft < 1 || !isFinite(dailyLeft) || dailyLeft < 0) return '';
    return t('预算剩 {p1} · 余 {p2} 天 · 日均 {p3}', { p1: formatCNY(remaining), p2: daysLeft, p3: formatCNY(dailyLeft) });
  }

  // ========== 月份图（消费页：一个月一张，7 列，数字 + 深浅）==========
  // 笔数分档写死（1 / 2 / 3-4 / 5+）：按最大值归一的话，一个记到 8 笔的日子会把其余日子压平。
  // 金额反过来——一个月里的钱差得太远，只能按当月最大值分四档。
  function countLevel(count) {
    const n = Number(count) || 0;
    if (n <= 0) return 0;
    if (n === 1) return 1;
    if (n === 2) return 2;
    if (n <= 4) return 3;
    return 4;
  }

  function amountLevel(amount, max) {
    const v = Number(amount) || 0;
    const m = Number(max) || 0;
    if (v <= 0 || m <= 0) return 0;
    const ratio = v / m;
    return ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : 1;
  }

  // 非等宽日期（'2026-2-3'）会让整格错位，直接丢。
  function dayTotals(expenses) {
    const map = {};
    (expenses || []).forEach(e => {
      if (!e) return;
      const d = String(e.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      const cur = map[d] || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(e.amount) || 0;
      map[d] = cur;
    });
    return map;
  }

  // 7 列（周一起），首行前面补空格让 1 号落在正确的星期；今天之后的日子标 future（页面据此禁用）。
  // 漏记天数只算「今天及以前且一笔都没有」的日子：今天还没过完，算进去等于每天早上都报漏。
  function monthGrid(expenses, month, mode, todayStr) {
    const [y, m] = String(month || '').split('-').map(Number);
    if (!y || !m || m < 1 || m > 12) return null;
    const totals = dayTotals(expenses);
    const total = daysInMonthOf(month);
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const today = String(todayStr || '');
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    let count = 0;
    let amount = 0;
    let maxAmount = 0;
    for (let d = 1; d <= total; d++) {
      const key = month + '-' + String(d).padStart(2, '0');
      const hit = totals[key];
      const c = hit ? hit.count : 0;
      const a = hit ? hit.total : 0;
      count += c;
      amount += a;
      if (a > maxAmount) maxAmount = a;
      const future = !!today && key > today;
      cells.push({ day: d, date: key, count: c, amount: a, future: future });
    }
    cells.forEach(cell => {
      if (!cell) return;
      cell.level = mode === 'amount' ? amountLevel(cell.amount, maxAmount) : countLevel(cell.count);
    });
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return {
      month: month, days: total, weeks: weeks, mode: mode,
      count: count, amount: amount, maxAmount: maxAmount,
    };
  }

  // 整月小票：按日期升序（同一天金额大的在前），读起来像流水账。
  function monthEntries(expenses, month) {
    const key = String(month || '');
    if (!/^\d{4}-\d{2}$/.test(key)) return [];
    return (expenses || [])
      .filter(e => e && String(e.date || '').slice(0, 7) === key)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      });
  }

  function dayEntries(expenses, day) {
    const key = String(day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return [];
    return (expenses || [])
      .filter(e => e && String(e.date || '') === key)
      .sort((a, b) => {
        const byAmount = (Number(b.amount) || 0) - (Number(a.amount) || 0);
        if (byAmount) return byAmount;
        return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
      });
  }

  // 格子上的数字：笔数直接写，金额折成整元/k——六位数塞不进一个几十像素的格子。
  function cellValue(cell, mode) {
    if (!cell || cell.count <= 0) return '';
    return mode === 'amount' ? shortCNY(cell.amount) : String(cell.count);
  }

  function shortCNY(v) {
    const n = Number(v) || 0;
    if (n <= 0) return '';
    if (n < 1000) return '¥' + Math.round(n);
    if (n < 10000) return '¥' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return '¥' + Math.round(n / 1000) + 'k';
  }

  // ========== 小票（消费页导出的那张热敏纸）==========
  function receiptModel(items, opts) {
    const o = opts || {};
    const list = (items || []).filter(e => e && typeof e === 'object');
    if (!list.length) return null;
    const rows = list.map(e => {
      const d = typeof o.describe === 'function' ? (o.describe(e) || {}) : {};
      const label = String(d.label == null ? (e.note == null ? '' : e.note) : d.label).trim();
      const sub = String(d.sub == null ? '' : d.sub).trim();
      return { label: label || t('（无备注）'), sub: sub, amount: money2(Number(e.amount) || 0) };
    });
    const total = list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return {
      date: String(o.date || ''),
      rows: rows,
      count: rows.length,
      total: total,
      totalText: money2(total),
    };
  }

  function receiptFileName(tag) {
    const t = String(tag || '');
    return /^\d{4}-\d{2}(-\d{2})?$/.test(t) ? 'receipt-' + t + '.png' : 'receipt.png';
  }

  function monthGridCellText(cell) {
    if (!cell) return '';
    const day = t('{m} 月 {d} 日', { m: Number(cell.date.slice(5, 7)), d: cell.day });
    if (cell.count <= 0) return day + ' · ' + t('这天没有记录');
    return day + ' · ' + t('{n} 笔', { n: cell.count }) + ' · ' + formatCNY(cell.amount);
  }

  // ========== 数据迁移 / 兜底（依赖全局 state，原地修改）==========
  // loadState（本地加载）与 importData（JSON 导入）共用，保证旧版数据导入后行为一致
  function migrateState() {
    // 语言设置先归一：后面的内置分类名要靠它取词（且 en 缺省时不能靠 t 的副作用）
    state.lang = normalizeLang(state.lang);
    // 分类的**形状**兑底（唯一收口）：导入的 JSON 可能是手改的——分类缺 tags、数组里混进 null。
    // 页面按 cat.tags.map / cat.name / cat.id 直接取值，缺一个字段就够让首屏 renderAll 抛错；
    // 而 importData 在渲染之前已经 saveJson 落盘，于是刷新也回不来（只能开发者工具清存档）。
    // 没有 id 的分类丢弃：它无法被引用、也无法编辑/删除，留着只会在卡片上留一块死区。
    ['categories', 'expenseCategories'].forEach(k => {
      const list = Array.isArray(state[k]) ? state[k] : [];
      state[k] = list
        .filter(c => c && typeof c === 'object' && !Array.isArray(c) && c.id != null && c.id !== '')
        .map(c => Object.assign({}, c, {
          id: String(c.id),
          name: typeof c.name === 'string' ? c.name : '',
          builtin: !!c.builtin,
          tags: normalizeTagArray(c.tags),
        }));
    });
    if (!Array.isArray(state.snapshots)) state.snapshots = [];
    state.snapshots = state.snapshots.filter(s => s && typeof s === 'object' && !Array.isArray(s));
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
    state.snapshots.forEach(s => {
      if (s && s.totalCNY == null) {
        // 与图表聚合共用同一折算口径（amountAtRates 的容错），不在此另写一份 reduce
        s.totalCNY = sumAmountCNY(s.assets, s.currencyRates || state.rates);
      }
    });
    if (!Array.isArray(state.categories)) state.categories = [];
    if (!Array.isArray(state.assets)) state.assets = [];
    // 记录同样只留对象（导入的数组里混进 null / 字符串会让渲染期 throw）
    state.assets = state.assets.filter(a => a && typeof a === 'object' && !Array.isArray(a));
    if (!state.categories.find(c => c.id === 'currency')) {
      // 名称只在**创建那一刻**取当前语言：分类名是用户数据，之后不随语言切换改写
      state.categories.unshift({ id: 'currency', name: t('货币类型'), builtin: true, tags: ['CNY', 'HKD', 'USD'] });
    }
    if (!state.rates || typeof state.rates !== 'object' || state.rates.CNY == null) {
      state.rates = { CNY: 1, HKD: 1, USD: 1, fetchedAt: null };
    } else {
      // 补全缺失货币字段，避免 toCNY 按 1:1 兜底导致数值失真
      if (state.rates.HKD == null) state.rates.HKD = 1;
      if (state.rates.USD == null) state.rates.USD = 1;
    }
    // 备份设置（旧数据/导入文件可能缺失）：默认每天自动备份，'off' 表示关闭。
    // lastBackup 只在**确认写入**后更新（手动导出与自动备份共用），也是「今天要不要再问」的唯一依据；
    // 旧的 lastAutoDownload（回退下载的节流）已移除——它让「没落盘」也记成「今天备份过了」
    if (!state.backup || typeof state.backup !== 'object') state.backup = {};
    state.backup.autoFreq = normalizeBackupFreq(state.backup.autoFreq);
    if (!state.backup.lastBackup) state.backup.lastBackup = null;
    // 压测情景（旧数据/导入文件可能缺失或指向已删分类标签）：归一 + 剪枝，失效即 null。
    // 只存跌幅不存金额——金额现算（汇率/账本都会变），存下来的数第二天就是错的
    state.stress = pruneStress(state.stress, state.categories);
    // 「上一次压测」：清除时把旧情景存这里，压测条上给一条回去的路。
    // 同一套归一与剪枝——指向已删分类标签的旧情景回去也不会命中任何东西。
    state.stressLast = pruneStress(state.stressLast, state.categories);
    // 快照提醒（旧数据/导入文件可能缺失）：窗口走白名单、天数钳 1~28；
    // 提醒日只认 'YYYY-MM-DD'——它只是「今天问过没有」的痕迹，脏值当没问过（不阻断提醒）
    state.snapshotReminder = normalizeSnapshotReminder(state.snapshotReminder);
    state.snapshotReminderLastPrompted = /^\d{4}-\d{2}-\d{2}$/.test(String(state.snapshotReminderLastPrompted || ''))
      ? state.snapshotReminderLastPrompted
      : null;
    // 用户设置字段（旧数据/导入数据可能缺失或为字符串）
    // 数字归一：字符串会让 formatCNY 走 String.toLocaleString 丢掉两位小数，统一转数字
    state.expenseExpectation = Number(state.expenseExpectation) || 0;
    state.netWorthTarget = Number(state.netWorthTarget) || 0;
    state.expenseGapDays = normalizeGapDays(state.expenseGapDays);
    state.gateLang = state.gateLang === 'zh' || state.gateLang === 'en' ? state.gateLang : '';
    if (state.incomeSafetyFactor == null) state.incomeSafetyFactor = 100;
    state.incomeSafetyFactor = Math.min(100, Math.max(1, Number(state.incomeSafetyFactor) || 100));
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
      if (a.cashRatio == null) a.cashRatio = 100;
      a.cashRatio = Math.min(100, Math.max(0, Number(a.cashRatio) || 0));
      // 防御: 导入数据中 amount 可能是字符串, 统一转为数字
      if (a.amount != null) a.amount = Number(a.amount) || 0;
      // 币种缺失/非法归 CNY：外币缺币种时汇率按 1 兜底，会把美元当人民币算进净资产
      if (typeof a.currency !== 'string' || !a.currency) a.currency = 'CNY';
      // tags 归一：DOM 侧多处直接 a.tags[catId]（资产列表/表单/快照详情）与分类 CRUD 的
      // it.tags[catId]，导入缺 tags 的资产会崩；与消费记录同一入口兑底
      if (!a.tags || typeof a.tags !== 'object') a.tags = {};
    });
    // 读数卡所选标签（旧数据/导入可能缺失或指向已删标签）: 与分类 CRUD 共用清理口径
    state.runwayTags = pruneRunwayTags(state.runwayTags, state.categories);
    // 读数卡的月消费自定值（旧数据/导入可能缺失、为字符串、或非有限数——JSON 里的 1e999 会解析成 Infinity）:
    // 0 = 未自定, 回落全局「预期月消费」; 只接受正有限数（严格同注释: 非法的归 0, 不留 Infinity/-1 在存档里）
    const customExpectation = Number(state.runwayExpectation);
    state.runwayExpectation = isFinite(customExpectation) && customExpectation > 0 ? customExpectation : 0;
    if (!Array.isArray(state.expenses)) state.expenses = [];
    state.expenses = state.expenses.filter(e => e && typeof e === 'object' && !Array.isArray(e));
    state.expenses.forEach(e => {
      if (!e) return;
      if (e.amount != null) e.amount = Number(e.amount) || 0;
      // date/tags 归一：DOM 侧多处直接 e.date.slice()/e.tags[catId]（列表/分布/趋势/明细），
      // 导入脏数据缺失时会崩；与 amount 同一入口兑底，不在各调用点重复防御
      if (e.date == null) e.date = '';
      if (!e.tags || typeof e.tags !== 'object') e.tags = {};
    });
    if (!Array.isArray(state.expenseCategories)) {
      state.expenseCategories = [];
    } else {
      state.expenseCategories = state.expenseCategories.filter(c => c.id !== 'expense-type' || !c.builtin);
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

  function moneyStr(v) {
    if (v == null || v === '') return '';
    const num = Number(String(v).replace(/,/g, ''));
    if (isNaN(num)) return '';
    const [int, dec] = String(num).split('.');
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec != null ? '.' + dec : '');
  }

  // 金额输入框字符串 → 数值：剥离千分位后 parseFloat，空/非法 → NaN（由调用方决定提示与兜底）。
  // 目标/资产/消费/预期/行内编辑四处保存共用，不再各写一遍 replace(/,/g)+parseFloat。
  function parseMoneyInput(raw) {
    return parseFloat(String(raw == null ? '' : raw).replace(/,/g, ''));
  }

  // 金额千分位 2 位格式化（与 formatCNY 区别: 不带 ¥ 符号；与 moneyStr 区别: 恒为两位小数的展示态，
  // 用于表格/对比/tooltip 等只读场景）。原先内联在 index.html，与 formatCNY/moneyStr 同族归此集中。
  // 非有限值（undefined/NaN/Infinity/非数字串）返回空串，避免渲染出字面量 NaN
  function money2(v) {
    const n = Number(v);
    if (!isFinite(n)) return '';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

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

  // 分类 pill 基色：资产/消费共用同一套，序数插值见 pillColors。
  // 放在 logic.js 是为了让「每个色板 × 每个插值点都达 AA」这条不变量可被单测钉住——
  // 它曾在亮色分支翻车：公式按色相重算底色，t=1 时底色被压深而字没跟着加深，实测 2.4:1。
  const CATEGORY_COLORS = [
    { bg: '#FFF1E6', fg: '#7E5023', border: '#F0D4B0' },  // terracotta
    { bg: '#E8F5EC', fg: '#3D7A52', border: '#B8DFC4' },  // sage green
    { bg: '#FFF8E1', fg: '#735B21', border: '#F0E0A8' },  // amber honey
    { bg: '#FCE8EF', fg: '#A34D68', border: '#F0C0D0' },  // dusty rose
    { bg: '#E8EEFA', fg: '#4A6099', border: '#B8C8E8' },  // soft cornflower
    { bg: '#FFF0E0', fg: '#7C5631', border: '#F0D8B8' },  // warm caramel
    { bg: '#E0F4F4', fg: '#2D6767', border: '#B0D8D8' },  // teal mist
    { bg: '#F4E8F4', fg: '#7A5080', border: '#D8C0D8' },  // soft mauve
    { bg: '#FBF3E0', fg: '#645123', border: '#E8D8A8' },  // golden wheat
    { bg: '#FCE8E0', fg: '#8B4332', border: '#F0C8B8' },  // coral warmth
  ];

  // 分类 pill 配色：同一分类内按标签序数插值（亮色: 浅底深字 / 暗色: 深底浅字）。
  // 亮色分支**锚定基色**插值，不按色相公式另起一套：否则 t=0 就偏离基色、
  // t=1 时底色被压深而字不变，整条色带跌出 AA（曾实测最低 2.4:1）。
  const lerp = (a, b, t) => a + (b - a) * t;
  function pillColors(base, t, dark) {
    if (dark) {
      const h = hexToHsl(base.bg).h;
      return {
        bg: hslToHex(h, 32 + t * 14, 14 + t * 7),
        fg: hslToHex(h, 44, 74 - t * 4),
        border: hslToHex(h, 30 + t * 16, 25 + t * 8),
      };
    }
    const H = hexToHsl(base.bg), F = hexToHsl(base.fg);
    return {
      // 底色只往「更浅更饱和」走，字色只往「更深更饱和」走：两者同向拉开，对比单调不减
      bg: hslToHex(H.h, lerp(H.s, 45, t), lerp(H.l, 84, t)),
      fg: hslToHex(F.h, lerp(F.s, 55, t), lerp(F.l, Math.max(26, F.l - 10), t)),
      border: hslToHex(H.h, lerp(H.s, 42, t), lerp(H.l, 80, t)),
    };
  }

  function basePill(base, dark) {
    return dark ? pillColors(base, 0, true) : { ...base };
  }

  // ========== 图表数据构造（纯，可单测）==========
  // 图表色板：base 内环基色、label 内环字色（浅底必须用墨字，固定白字实测 7/10 不达 AA）、shades 外环三阶。
  const CHART_INK = '#211B10';
  const CATEGORY_PALETTE = [
    { base: '#BB5647', label: '#FFFFFF', shades: ['#AF776F', '#BF938C', '#D0AFAA'] },
    { base: '#428069', label: '#FFFFFF', shades: ['#60907E', '#79A595', '#94B7AA'] },
    { base: '#AE7D29', label: '#211B10', shades: ['#A18047', '#B8975E', '#C6AB7E'] },
    { base: '#4977AB', label: '#FFFFFF', shades: ['#6D88A7', '#899FB8', '#A6B6C9'] },
    { base: '#A1664C', label: '#FFFFFF', shades: ['#A37E6E', '#B5978A', '#C7B0A6'] },
    { base: '#7F6BA1', label: '#FFFFFF', shades: ['#8D80A3', '#A59AB6', '#BDB5C9'] },
    { base: '#B6783A', label: '#211B10', shades: ['#A77E56', '#B79573', '#C7AC91'] },
    { base: '#3E7E7C', label: '#FFFFFF', shades: ['#5D8E8C', '#74A4A3', '#90B7B5'] },
    { base: '#B6593D', label: '#FFFFFF', shades: ['#AF7867', '#BF9385', '#CFADA3'] },
    { base: '#A3626F', label: '#FFFFFF', shades: ['#A17D84', '#B4979D', '#C7B2B6'] },
  ];

  // 同分类下「第几个条目」→ 外环色阶（buildSunburstData 与堆叠柱共用一套轮转规则，
  // 避免两处各写一遍 `ai % shades.length` 而漂移）
  function shadeAt(pal, i) {
    return pal.shades[i % pal.shades.length];
  }

  // 旭日图数据构造（三图共用）：childValue 决定扇区数值，child 的 extra 透传到节点。
  // 字色写在节点上（label.color）——实测 ECharts 5 对 levels 里的函数型 color 不保证逐节点求值。
  function buildSunburstData(cat, groups, childValue) {
    return cat.tags
      .filter(t => (groups[t] || []).length > 0)
      .map((tag, ti) => {
        const pal = CATEGORY_PALETTE[ti % CATEGORY_PALETTE.length];
        const children = (groups[tag] || []).map((child, ai) => {
          const node = {
            name: child.name,
            value: Math.round(childValue(child) * 100) / 100,
            itemStyle: { color: shadeAt(pal, ai) },
            label: { color: CHART_INK }, // 外环是同色相浅阶 → 一律墨字
          };
          if (child.extra) Object.assign(node, child.extra);
          return node;
        });
        return { name: tag, itemStyle: { color: pal.base }, label: { color: pal.label }, children };
      });
  }

  // 旭日图的「视图」：喂给图的数据与占比分母都由清单的选中态派生，不让 ECharts 自己下钻
  // （那会引入第二套 viewRoot，于是「返回全部」只清了清单、图还停在下钻层）。
  function sunburstDrillView(data, total, selected) {
    const list = Array.isArray(data) ? data : [];
    const sel = selected ? list.find(n => n && n.name === selected) : null;
    if (!sel) return { data: list, total: Number(total) || 0 };
    return { data: [sel], total: nodeValue(sel) };
  }

  function pctStr(value, total) {
    return total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
  }

  // 旭日图节点的「有效值」：叶子节点用 value；**分类节点（内环）本身不带 value**——
  // ECharts 是按 children 求和来定扇区大小的（buildSunburstData 也只给叶子写 value），
  // 故取值必须同一个口径：自己求和。曾直接读 n.value，于是内环全算出 0（清单里满屏 ¥0.00）。
  function nodeValue(n) {
    if (!n) return 0;
    const own = Number(n.value);
    if (Number.isFinite(own)) return own;
    if (Array.isArray(n.children)) return n.children.reduce((s, c) => s + nodeValue(c), 0);
    return 0;
  }

  function sunburstNodePath(data, catIdx, childIdx) {
    const list = data || [];
    if (!Number.isInteger(catIdx) || catIdx < 0 || catIdx >= list.length) return null;
    let flat = 1; // 虚拟根占 0
    for (let i = 0; i < catIdx; i++) {
      flat += 1 + childCount(list[i]);
    }
    if (childIdx === null || childIdx === undefined) return flat;
    const kids = (list[catIdx] && Array.isArray(list[catIdx].children)) ? list[catIdx].children : [];
    if (!Number.isInteger(childIdx) || childIdx < 0 || childIdx >= kids.length) return null;
    return flat + 1 + childIdx;
  }

  // 节点的子项数（children 不是数组时按 0——脏数据不该让整个清单崩掉）
  function childCount(node) {
    return (node && Array.isArray(node.children)) ? node.children.length : 0;
  }

  function sunburstLegendRows(data, total, selected) {
    const list = data || [];
    const sel = list.find(n => n && n.name === selected);
    if (sel) {
      const kids = Array.isArray(sel.children) ? sel.children : [];
      const sub = nodeValue(sel); // 条目级分母 = 该分类合计（与图上这个扇区的大小同源）
      return kids
        .map((k, i) => ({
          idx: i,
          name: (k && k.name) || '',
          value: nodeValue(k),
          pct: pctStr(nodeValue(k), sub),
          path: [sel.name, i],
        }))
        .sort((a, b) => b.value - a.value);
    }
    return list
      .map((n, idx) => ({ idx, name: (n && n.name) || '', value: nodeValue(n), pct: pctStr(nodeValue(n), Number(total) || 0), path: null }))
      .sort((a, b) => b.value - a.value);
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

  // 堆叠柱标签顺序（历史净值/消费趋势共用）：按各标签跨月合计降序，大的放柱底。
  // monthlyTagValues: [{ 标签名: 金额 }, ...] 每个元素代表一个月的「标签→金额」映射。
  // 合计相同保持 cat.tags 原顺序（Array.sort 稳定）；cat 缺失/tags 为空返回 []；不修改入参。
  function sortTagsByTotal(cat, monthlyTagValues) {
    const tags = (cat && cat.tags) || [];
    const totals = {};
    tags.forEach(t => { totals[t] = 0; });
    (monthlyTagValues || []).forEach(m => {
      tags.forEach(t => { totals[t] += (m && m[t]) || 0; });
    });
    return tags.slice().sort((a, b) => totals[b] - totals[a]);
  }

  function percentSeriesData(raw, totals) {
    return raw.map((v, vi) => ({
      value: totals[vi] > 0 ? +(v / totals[vi] * 100).toFixed(1) : 0,
      raw: Math.round(v * 100) / 100,
    }));
  }

  // ========== 数据防丢备份决策（接收显式 state 参数，保持纯净可测）==========
  // 提醒阈值：距上次备份超过该天数视为「久未备份」
  const BACKUP_STALE_DAYS = 7;

  function hasAnyBackupWorthyData(s) {
    s = s || {};
    return (s.assets || []).length > 0 ||
           (s.expenses || []).length > 0 ||
           (s.snapshots || []).length > 0;
  }

  function normalizeBackupFreq(v) {
    return ['daily', 'weekly', 'off'].includes(v) ? v : 'daily';
  }

  // 备份状态文案：「上次备份 X（今天）」/「尚未备份过」。
  // 「备份与导入」弹窗与设置弹窗共用，避免两处文案漂移；参数显式传入保持纯净可测
  function backupNoteText(lastBackup, today) {
    if (!lastBackup) return t('尚未备份过');
    return lastBackup === today
      ? t('上次备份 {p1}（今天）', { p1: lastBackup })
      : t('上次备份 {p1}', { p1: lastBackup });
  }

  // 今天该不该自动备份：off / 无数据 → 否；从未备份或日期损坏 → 是；daily 当天已备份 → 否；weekly 不足 7 天 → 否。
  // 只看 lastBackup（确认写入才更新）：取消/回退下载都不算「备份过」。
  function shouldAutoBackup(s, today) {
    const b = (s && s.backup) || {};
    if (b.autoFreq === 'off' || !hasAnyBackupWorthyData(s)) return false;
    const gap = b.lastBackup ? daysBetweenStr(b.lastBackup, today) : null;
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

  // ========== 备份写入位置 / 文件名 / 结果口径 ==========
  // 导出内容的唯一来源：深拷贝后逐条剥离快照加工字段 totalCNY（可由 assets × currencyRates 重算）。
  // 不改入参；null / 缺字段按空处理，保证三条导出路径（目录 / 保存框 / 下载）落盘内容一致。
  function backupJSONText(s) {
    const clean = JSON.parse(JSON.stringify(s == null ? {} : s));
    (clean.snapshots || []).forEach(sn => { delete sn.totalCNY; });
    return JSON.stringify(clean, null, 2);
  }

  // 当天备份文件名：第 1 次 base，第 2 次起加 -2/-3 后缀（不覆盖已有文件）。
  // attempt 只认 ≥2 的整数，脏值一律回落 base，避免拼出 -NaN / -1.5 之类文件名。
  function backupFileName(today, attempt) {
    const seq = Number.isInteger(attempt) && attempt >= 2 ? '-' + attempt : '';
    return `wealth-data-${today}${seq}.json`;
  }

  // 在已有文件名集合里找第一个未占用的当天备份名（数组 / Set 均可）。绝不覆盖：探测不到空闲名就返回带更大的后缀
  function nextBackupFileName(today, existingNames) {
    const taken = existingNames instanceof Set
      ? existingNames
      : new Set(Array.isArray(existingNames) ? existingNames : []);
    let seq = 1;
    while (taken.has(backupFileName(today, seq))) seq++;
    return backupFileName(today, seq);
  }

  // 落点：一律过系统文件窗口，弹不出来才回退下载。目录授权跨会话不可靠（Chrome 只撑到关标签页），
  // 而定时器里没有用户手势、无法申请授权——「设置了文件夹却仍弹下载框」就是这么来的。缺省按「弹不出」处理。
  function backupWritePlan(opts) {
    opts = opts || {};
    return { target: opts.supportsPicker ? 'file' : 'download' };
  }

  // 备份确认框文案（自动备份专用）：写清「哪个文件、写到哪个目录」，
  // 目录名缺省时不留空括号。手动导出由按钮本身承担确认，不需要这一层。
  function backupPromptText(mode, fileName, folderName) {
    const name = fileName || '';
    const where = folderName ? t(' → 「{p1}」', { p1: folderName }) : '';
    const head = mode === 'auto' ? t('今日自动备份') : t('导出备份');
    return { msg: t('{head}：{name}{where}', { head: head, name: name, where: where }), title: mode === 'auto' ? t('自动备份') : t('导出备份') };
  }

  // 写入结果 → 便条与状态口径（单一来源）。只有 written 算「已备份」；
  // 取消 / 失败 / 回退下载一律不记 lastBackup（也就意味着当天再进来还会再问一次），
  // 回退下载同样没有回执，故文案中性、不虚报成功。
  function backupResultNotice(o) {
    o = o || {};
    const auto = o.mode === 'auto';
    if (o.status === 'error') {
      return { msg: t('导出失败，请重试'), type: 'error', recordBackup: false };
    }
    if (o.status === 'cancelled') {
      return { msg: t('已取消备份'), type: 'info', recordBackup: false };
    }
    if (o.status === 'downloaded' || o.target === 'download') {
      return { msg: t('已开始下载，请在下载栏确认'), type: 'info', recordBackup: false };
    }
    if (auto) {
      return {
        msg: t('已自动备份') + (o.folderName ? t('到「{p1}」', { p1: o.folderName }) : ''),
        type: 'success', recordBackup: true,
      };
    }
    return { msg: t('数据已导出'), type: 'success', recordBackup: true };
  }

  function exportErrorNotice(e, stage) {
    const name = (e && e.name) || '';
    const notice = (msg) => ({ msg: msg, type: 'error', recordBackup: false });
    if (name === 'no-webcrypto') return notice(t('这个页面不是安全环境（https 或 localhost），不能加密；换地址打开，或先清空导出密钥'));
    if (name === 'bad-handle') return notice(t('保存窗口给回来的句柄不能用（被扩展或浏览器改过），换个浏览器再试'));
    if (stage === 'picker' && (name === 'NotAllowedError' || name === 'SecurityError')) {
      return notice(t('浏览器没允许打开保存窗口（多半是扩展或策略拦下了），换 Chrome / Edge 或先清空「备份文件夹」再试'));
    }
    if (name === 'NoModificationAllowedError') return notice(t('这个文件现在写不进去（可能正被其他程序打开），换个位置再试'));
    if (name === 'NotAllowedError' || name === 'SecurityError') return notice(t('浏览器不允许写入这个位置，换一个文件夹再试'));
    if (name === 'QuotaExceededError') return notice(t('磁盘没有空间了，无法写入'));
    const step = stage === 'picker' ? t('打开保存窗口') : stage === 'encrypt' ? t('加密') : t('写文件');
    return notice(name
      ? t('导出失败：{step}这一步没成功（{p1}）', { step: step, p1: name })
      : t('导出失败：{step}这一步没成功', { step: step }));
  }

  // 设置里「备份文件夹」边注：它现在是**文件窗口的起点目录**，不再是「直接写入」的开关
  function backupDirNoteText(hasDir, name, supported) {
    if (!hasDir) {
      return supported
        ? t('未选择，文件窗口默认打开上次的目录')
        : t('当前浏览器不支持选择文件夹，备份将下载到「下载」文件夹');
    }
    const n = name || t('备份文件夹');
    return supported
      ? t('已选择「{p1}」，文件窗口默认打开这里', { p1: n })
      : t('已选择「{p1}」，但当前浏览器不支持指定目录，文件窗口从默认位置打开', { p1: n });
  }

  const BACKUP_ENC_FORMAT = 'wealth-backup-encrypted';
  const BACKUP_ENC_VERSION = 1;
  const BACKUP_KDF_ITERATIONS = 300000;
  const BACKUP_PASSPHRASE_MIN = 8;
  const BACKUP_KDF_ITERATIONS_MAX = 1000000;

  function passphraseTooShort(p) {
    return String(p == null ? '' : p).length < BACKUP_PASSPHRASE_MIN;
  }

  function isEncryptedBackup(o) {
    return !!o && typeof o === 'object' &&
      o.format === BACKUP_ENC_FORMAT &&
      typeof o.payload === 'string' &&
      !!o.kdf && typeof o.kdf.salt === 'string' && typeof o.kdf.iterations === 'number' &&
      !!o.cipher && typeof o.cipher.iv === 'string';
  }

  function backupModeText(set) {
    return set ? t('导出加密') : t('导出明文');
  }

  function utf8Bytes(str) { return new TextEncoder().encode(str); }

  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function base64ToBytes(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    const out = new Uint8Array(n);
    globalThis.crypto.getRandomValues(out);
    return out;
  }

  function backupAad(version) { return utf8Bytes(BACKUP_ENC_FORMAT + '/v' + version); }

  async function deriveBackupKey(passphrase, salt, iterations) {
    const subtle = globalThis.crypto.subtle;
    const base = await subtle.importKey('raw', utf8Bytes(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encryptBackup(jsonText, passphrase) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      const e = new Error('no-webcrypto');
      e.name = 'no-webcrypto';
      throw e;
    }
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveBackupKey(passphrase, salt, BACKUP_KDF_ITERATIONS);
    const ct = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: backupAad(BACKUP_ENC_VERSION) }, key, utf8Bytes(jsonText));
    return JSON.stringify({
      format: BACKUP_ENC_FORMAT,
      version: BACKUP_ENC_VERSION,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: BACKUP_KDF_ITERATIONS, salt: bytesToBase64(salt) },
      cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
      payload: bytesToBase64(new Uint8Array(ct)),
    }, null, 2);
  }

  async function decryptBackup(env, passphrase) {
    if (!isEncryptedBackup(env)) throw new Error('not-an-encrypted-backup');
    const iterations = Math.min(Math.max(Math.trunc(env.kdf.iterations), 1), BACKUP_KDF_ITERATIONS_MAX);
    const key = await deriveBackupKey(passphrase, base64ToBytes(env.kdf.salt), iterations);
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(env.cipher.iv), additionalData: backupAad(env.version) },
      key, base64ToBytes(env.payload));
    return new TextDecoder().decode(plain);
  }

  // ========== 汇率刷新提示决策 ==========
  // 拉取失败时的便条文案与类型：有缓存可回退 → info「使用缓存汇率」（中性金墨边注，注意但不报警）；
  // 连缓存都没有 → error「汇率获取失败」（报警红）。fetchRates 的 catch 只做 DOM 副作用，
  // 分支决策抽在此保持纯净可测
  function rateFallbackNotice(hasCache) {
    return hasCache
      ? { msg: t('使用缓存汇率'), type: 'info' }
      : { msg: t('汇率获取失败'), type: 'error' };
  }

  // 汇率响应形状校验：任一币种不是有限正数就整体拒绝（返回 null → 走回退）。字段缺失得 NaN、给 0 得 Infinity，
  // 写进 state.rates 后每个合计都脏，而便条还说「汇率已更新」；半个响应可信时混用比全旧更难解释。
  function ratesFromApi(cny) {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!cny || typeof cny !== 'object' || !ok(cny.hkd) || !ok(cny.usd)) return null;
    return {
      CNY: 1,
      HKD: 1 / cny.hkd,
      USD: 1 / cny.usd,
      fetchedAt: new Date().toISOString()
    };
  }

  // ========== 便条的播报优先级 ==========
  // error → assertive（现在就得知道），其余 → polite；判据在这里，DOM 只写属性。
  function toastLiveMode(type) {
    return type === 'error' ? 'assertive' : 'polite';
  }

  // ========== 下拉框的固有宽度（base-select 之后的补偿）==========
  // base-select 不再按最长选项取宽，换选项时宽度会跳；field-sizing/content 那几种写法实测全部无效，只能量一次钉住。
  // 不该钉的两种：选项全空（还在等填充）、选项全是空串（占位项）。
  function shouldPinSelectWidth(labels) {
    return (labels || []).some((t) => String(t == null ? '' : t).trim() !== '');
  }

  // ========== 拖拽排序的键盘替代 ==========
  // 只管「数组里怎么挪」（可单测）；返回新数组而不改原数组，避免配合重绘时序时静默不刷新。
  function moveAssetIndex(arr, from, to) {
    if (!Array.isArray(arr) || arr.length < 2) return arr;
    if (!Number.isInteger(from) || !Number.isInteger(to)) return arr;
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr;
    const next = arr.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  // ========== 弹窗自动弹出后的指针守卫 ==========
  // 长按满时长自动弹框时，抬起的手指会紧跟一次 pointerup/click 把遮罩点掉；弹出后一小段窗口内忽略指针事件。
  const AUTO_OPEN_GUARD_MS = 400;
  function autoOpenGuard(elapsedSinceOpen, guardMs) {
    const g = guardMs === undefined ? AUTO_OPEN_GUARD_MS : guardMs;
    return elapsedSinceOpen >= g;
  }

  // ========== 弹窗焦点陷阱 ==========
  // 15 个弹窗都写了 aria-modal，但写对 ARIA 不等于接管了焦点：判据在这里（可单测），DOM 侧执行 focus()。
  // wrap=false 交还浏览器默认；index=-1（焦点不在弹窗内）一律拉回来，否则 aria-modal 的承诺立刻是假的。
  function trapFocus(currentIdx, count, shift) {
    if (!(count > 0)) return { wrap: false, index: -1 }; // 没有可聚焦元素：连「关闭」都按不到，别接管
    if (currentIdx < 0 || currentIdx >= count) {
      // 不在弹窗内：向前拉回第一个，向后拉回最后一个
      return { wrap: true, index: shift ? count - 1 : 0 };
    }
    const next = shift ? currentIdx - 1 : currentIdx + 1;
    if (next < 0 || next >= count) {
      return { wrap: true, index: shift ? count - 1 : 0 };
    }
    return { wrap: false, index: next };
  }

  // ========== 金额合计（按显式汇率表折算为 CNY）==========
  // 汇率表由调用方传（资产按当前汇率、消费恒为 CNY）；脏数据不污染总数——界面上的总数必须始终能显示。
  function sumAmountCNY(items, rates) {
    return (items || []).reduce((s, it) => {
      const v = amountAtRates(it && it.amount, it && it.currency, rates);
      return s + (Number.isFinite(v) ? v : 0);
    }, 0);
  }

  // ========== 多语言词条（en）==========
  // 键 = 中文原文（页面里的 data-i18n / i18n.t 参数）。值 = 英文；需要单复数的写成
  // [单数, 复数]（由 vars.n 选择），插值占位符用 {name}。
  // 修改中文键必须同步这里，否则 en 下回落中文（ui-wiring 的覆盖率用例会红）。
  const I18N_EN = {
    '财富管理': 'Wealth Management',
    '本机保存的个人资产与消费账本：记录资产、月度快照、消费与趋势，数据不上传。': 'A private ledger for assets and spending, kept on this device. Nothing is uploaded.',
    '消费': 'Expenses',
    '资产': 'Assets',
    '设置': 'Settings',
    '资产管理': 'Assets',
    '分类管理': 'Categories',
    '资产分布': 'Distribution',
    '历史净值': 'History',
    '收益测算': 'Income',
    '消费记录': 'Expenses',
    '消费分布': 'Distribution',
    '消费趋势': 'Trends',
    '结构视图': 'Structure',
    '趋势分析': 'Trend',
    '收益预估': 'Estimate',
    '净资产 · 截至': 'Net worth · as of',
    '＋ 登记资产': '＋ Add asset',
    '登记资产': 'Add asset',
    '去校验': 'Review',
    '还没有资产记录': 'No assets yet',
    '点击「登记资产」或导入示例数据开始': 'Tap “Add asset” or import sample data to start',
    '导入示例数据': 'Import sample data',
    '名称': 'Name',
    '金额': 'Amount',
    '货币': 'Currency',
    '金额 (CNY)': 'Amount (CNY)',
    '预期年化': 'Expected rate',
    '标签': 'Tags',
    '维度与标签': 'Dimensions & tags',
    '管理资产的分类与标签': 'Manage asset categories and tags',
    '＋ 新增分类': '＋ New category',
    '按分类维度查看资产分布（已换算 CNY）': 'Asset mix by category, converted to CNY',
    '资产分布分类维度': 'Distribution category',
    '构成': 'Composition',
    '登记资产后，这里会按维度展示资产构成': 'Add assets and their composition appears here',
    '去登记资产': 'Add assets',
    '月度快照': 'Monthly snapshots',
    '记录每月快照，看净值趋势': 'Save a snapshot each month to see the trend',
    '历史净值分类维度': 'History category',
    '占比': 'Share',
    '对比快照': 'Compare snapshots',
    '点击柱中色块，可展开该月该标签的构成明细': 'Click a segment to expand that month’s breakdown',
    '还没有月度快照': 'No snapshots yet',
    '每月点击「记录快照」留存一次净值；至少两个月才能显示趋势': 'Take a snapshot every month; two or more months show a trend',
    '记录快照': 'Take snapshot',
    '按资产金额与预期年利率测算收益': 'Estimated from balances and expected annual rates',
    '使用最低': 'Use low',
    '使用最高': 'Use high',
    '安全边际': 'Safety margin',
    '安全边际因子（百分比）': 'Safety margin factor (percent)',
    '暂无收益测算数据': 'No income data yet',
    '在「资产管理」中登记资产并填写预期年利率，这里会显示收益测算。': 'Add assets with expected annual rates under Assets and the estimate appears here.',
    '去资产管理': 'Go to assets',
    '总收益 · 月': 'Total income · month',
    '现金收益 · 月': 'Cash income · month',
    '年': 'Year',
    '日': 'Day',
    '现金占比': 'Cash share',
    '设定预期月消费，看看收益能否覆盖日常开销': 'Set expected monthly spend to see whether income covers it',
    '设定': 'Set',
    '总收益': 'Total income',
    '现金收益': 'Cash income',
    '÷ 预期月消费': '÷ Expected monthly spend',
    '修改': 'Edit',
    '收益分布': 'Income mix',
    '收益分布分类维度': 'Income mix category',
    '搜索备注 / 标签 / 分类': 'Search notes / tags',
    '清除搜索': 'Clear search',
    '消费月份筛选': 'Filter by month',
    '按标签筛选': 'Filter by tag',
    '＋ 记录消费': '＋ Add expense',
    '记录消费': 'Add expense',
    '还没有消费记录': 'No expenses yet',
    '点击「记录消费」或导入示例数据开始': 'Tap “Add expense” or import sample data to start',
    '导入示例消费数据': 'Import sample expenses',
    '清除筛选': 'Clear filters',
    '日期': 'Date',
    '备注': 'Note',
    '消费分类管理': 'Expense categories',
    '管理消费的分类与标签': 'Manage expense categories and tags',
    '按分类维度和月份查看消费分布': 'Spending mix by category and month',
    '消费分布月份': 'Distribution month',
    '消费分布分类维度': 'Distribution category',
    '记录消费后，这里会展示分类占比': 'Add expenses and their category share appears here',
    '去记录消费': 'Add expenses',
    '按月查看消费趋势': 'Monthly spending trend',
    '消费趋势分类维度': 'Trend category',
    '对比两月': 'Compare months',
    '预期消费': 'Expected spend',
    '记录消费后，这里会按月展示消费趋势': 'Add expenses and the monthly trend appears here',
    '本月已花 ÷ 预期月消费': 'Spent this month ÷ expected monthly spend',
    '选几个标签、填月消费，看看这些钱能撑几个月': 'Pick tags and a monthly spend to see how long the money lasts',
    '标签与月消费': 'Tags & monthly spend',
    '预期月消费': 'Expected monthly spend',
    '快照详情': 'Snapshot details',
    '关闭': 'Close',
    '快照对比': 'Compare snapshots',
    '起始月': 'From',
    '结束月': 'To',
    '总净值变动': 'Net worth change',
    '金额按各快照当时汇率折算为 CNY': 'Amounts converted to CNY at each snapshot’s rate',
    '消费对比': 'Compare spending',
    '维度': 'Dimension',
    '总消费变动': 'Spending change',
    '按所选维度逐标签拆分，金额单位为 CNY': 'Split by tag in the chosen dimension; amounts in CNY',
    '将保存当前所有资产数据': 'Saves a copy of all current assets',
    '备注（可选）': 'Note (optional)',
    '取消': 'Cancel',
    '确认快照': 'Save snapshot',
    '资产名称': 'Asset name',
    '如：招商银行活期': 'e.g. Bank savings',
    '预期年化收益率 (%)': 'Expected annual rate (%)',
    '最低': 'Low',
    '预期年化收益率下限 (%)': 'Expected annual rate, low (%)',
    '最高': 'High',
    '预期年化收益率上限 (%)': 'Expected annual rate, high (%)',
    '现金比例 (%)': 'Cash share (%)',
    '现金比例（百分比）': 'Cash share (percent)',
    '全额现金': 'All cash',
    '纯增值': 'All growth',
    '预期收益中来自股息 / 利息 / 租金等现金流的比例。存款、债券拉满；股票按分红占比估。': 'Share of expected income paid as cash: dividends, interest, rent. Savings and bonds are 100%; for shares estimate the dividend yield.',
    '保存': 'Save',
    '新增分类': 'New category',
    '分类名称': 'Category name',
    '如：资产类型': 'e.g. Asset type',
    '标签（逗号分隔）': 'Tags (comma separated)',
    '如：固定资产, 股票, 债券': 'e.g. Property, Shares, Bonds',
    '备份与导入': 'Backup & import',
    '导出当前所有数据为 JSON 文件': 'Export everything as a JSON file',
    '导出数据': 'Export',
    '从 JSON 文件导入数据（将覆盖当前数据）': 'Import a JSON file (replaces current data)',
    '选择文件': 'Choose file',
    '确认操作': 'Confirm',
    '确认': 'Confirm',
    '可选备注': 'Optional note',
    '新增消费分类': 'New expense category',
    '如：支付方式': 'e.g. Payment method',
    '如：微信, 支付宝, 现金': 'e.g. Card, Cash, Transfer',
    '数据校验': 'Data check',
    '下面这些记录在某个分类下还没有标签。组内顶部可一键补齐，也可以在每条记录上逐个点选，点一下即保存。': 'These records are missing a tag in one category. Fill the whole group at once, or pick a tag on each record; every pick saves immediately.',
    '全部记录都已归类。': 'Everything is tagged.',
    '完成': 'Done',
    '在消费趋势图中显示为水平参考线，收起部分类别后可对比每月合计': 'Drawn as a reference line in the trend chart; collapse categories to compare monthly totals',
    '预期月消费 (CNY)': 'Expected monthly spend (CNY)',
    '清除': 'Clear',
    '确认清除预期月消费？': 'Clear the expected monthly spend?',
    '确认清除目标净资产？': 'Clear the net worth target?',
    '确认清除备份文件夹？': 'Clear the backup folder?',
    '确认移除标签「{p1}」？{p2} 条记录上的归类也会被清空。': 'Remove tag “{p1}”? {p2} records will lose their tag assignment.',
    '导入将覆盖当前所有数据，确认继续？': 'Importing replaces all current data. Continue?',
    '标签如何参与计算': 'How tags combine',
    '同一分类内多选为「或」，不同分类之间为「且」；某个分类不选则不参与过滤。': 'Tags within one category are OR; across categories they are AND. Leave a category empty to ignore it.',
    '月消费 (CNY)': 'Monthly spend (CNY)',
    '默认': 'Default',
    '目标净资产': 'Net worth target',
    '设置后资产页显示达成进度': 'Shows progress on the assets page',
    '目标净资产 (CNY)': 'Net worth target (CNY)',
    '语言': 'Language',
    '界面文字与图表的语言。分类、标签与备注是你自己的账本内容，不会被改名。': 'Language for the interface and charts. Category, tag and note text is your own ledger content and is never renamed.',
    '界面语言': 'Interface language',
    'English': 'English',
    '中文': '中文',
    '外观': 'Appearance',
    '切换日间纸页与夜间墨底，立即生效并记住选择': 'Switch between paper by day and ink by night; applies at once and is remembered',
    '外观主题': 'Theme',
    '日间': 'Light',
    '夜间': 'Dark',
    '自动备份': 'Auto backup',
    '打开页面几秒后会弹一次确认，确认后弹出文件窗口保存一份带日期的备份，日积月累即是版本历史。建议把保存位置设为网盘同步文件夹（OneDrive / iCloud 等），电脑损坏后也能找回。': 'A few seconds after the page opens you are asked once. Confirming opens a save dialog for a dated backup; collected over time that becomes your version history. Point it at a synced folder (OneDrive, iCloud) so a broken computer does not lose it.',
    '自动备份频率': 'Auto backup frequency',
    '每天': 'Daily',
    '每周': 'Weekly',
    '备份文件夹': 'Backup folder',
    '选择后，备份时弹出的文件窗口默认就打开这个目录（自动与手动一致）；未选择时窗口打开上次用过的目录。仅 Chrome / Edge 支持指定目录。': 'Once chosen, the save dialog opens in this folder for both automatic and manual backups. Otherwise it opens wherever you saved last. Only Chrome / Edge can target a folder.',
    '选择文件夹': 'Choose folder',
    '备份与导入…': 'Backup & import…',
    '汇率响应缺少有效币种': 'The rate response had no usable currency',
    '汇率已更新': 'Rates updated',
    '资产波动大，反复看容易被涨跌牵着走。抄下这一句再进去。': 'Prices swing, and watching often lets the swings pull at you. Copy the line below to go on.',
    '进入资产页': 'Enter assets',
    '抄写这句话': 'Copy this line',
    '与原句不一致，请重抄一遍': 'Not the same line — please copy it again',
    '不看': 'Not now',
    '进入': 'Enter',
    // ===== 压测（全局视图叠加）=====
    // 「压测」在英文里选 stress test 是金融业的通用说法（stress testing a portfolio），
    // 不用 pressure / crash —— 前者是物理压力，后者是结果不是动作。
    '压测': 'Stress test',
    '压测情景': 'Stress scenario',
    '压测如何计算': 'How the stress test is calculated',
    '压测只是一组假设：只改页面上的读数，账本金额、快照与导出都不动，刷新即回到真实值。只按选中的这一个维度打折（一笔钱不会被打两次），未调的分类不参与。': 'A stress test is only a set of assumptions: it changes the figures on screen, nothing else — ledger amounts, snapshots and exports stay untouched, and a refresh returns to real values. Only the selected dimension is discounted (no amount is discounted twice); other categories are unaffected.',
    '压测维度': 'Stress dimension',
    '压测 {p1}': 'Stress test {p1}',
    ' · 原值 ': ' · was ',
    '压测中': 'Stress test on',
    '压测：未启用': 'Stress test: off',
    '压测中：{p1}': 'Stress test: {p1}',
    '压测：先在「分类管理」里建一个分类': 'Stress test: create a category under Categories first',
    '先在「分类管理」里建一个分类': 'Create a category under Categories first',
    ' · 未归类 {p1} 按未打折计入': ' · unclassified {p1} counted undiscounted',
    '{p1} 的剩余比例（百分比）': 'Remaining share of {p1} (percent)',
    '该维度下未归类的资产（{p1}，{p2} 项）按未打折计入。': 'Assets with no tag in this dimension ({p1}, {p2}) are counted undiscounted.',
    '压测已启用': 'Stress test on',
    '压测已清除': 'Stress test cleared',
    '未设置': 'Not set',
    ' · 现金 ': ' · Cash ',
    '调整排序，按上移或下移': 'Reorder: press up or down',
    '拖动排序（键盘：聚焦后按 ↑/↓）': 'Drag to reorder (keyboard: focus, then ↑/↓)',
    '点击快速更新金额': 'Click to update the amount',
    '编辑': 'Edit',
    '删除': 'Delete',
    '目标已达成': 'Target reached',
    '还差 ': 'Short by ',
    '目标净资产 · ': 'Net worth target · ',
    '设定目标': 'Set target',
    '{p1} 项资产': [ '{p1} asset', '{p1} assets' ],
    '预期月消费 ': 'Expected monthly spend ',
    '预估月收益 ': 'Est. monthly income ',
    '现金收益 ': 'Cash income ',
    '请输入有效的目标金额': 'Enter a valid target amount',
    '目标已更新': 'Target updated',
    '目标已设置': 'Target set',
    '目标已清除': 'Target cleared',
    'Enter 保存 · 小键盘 Enter/Tab 下一行 · Esc 取消': 'Enter saves · Numpad Enter/Tab moves down · Esc cancels',
    '金额无效，已恢复原值': 'Invalid amount; previous value restored',
    '编辑资产': 'Edit asset',
    '请输入有效的金额': 'Enter a valid amount',
    '最低利率不能高于最高利率': 'Low rate cannot exceed high rate',
    '请为每个分类选择标签': 'Pick a tag for every category',
    '资产已更新': 'Asset updated',
    '资产已登记': 'Asset added',
    '确认删除该资产？': 'Delete this asset?',
    '已删除': 'Deleted',
    '图表组件加载失败': 'The chart library failed to load',
    '‹ 全部分类': '‹ All categories',
    '长按可改名': 'Press and hold to rename',
    '标签 {p1}，长按或按回车改名': 'Tag {p1}: press and hold, or Enter, to rename',
    '移除标签': 'Remove tag',
    '分类已更新': 'Category updated',
    '分类已创建': 'Category created',
    '下面这些资产在某个分类下还没有标签（新增分类后老资产会缺）。组内顶部可一键补齐，也可以在每条资产上逐个点选，点一下即保存。历史快照按当时数据保留，不随补齐更新。': 'These assets are missing a tag in one category (assets created earlier lack tags added later). Fill the whole group at once, or pick a tag on each asset; every pick saves immediately. Snapshots keep the data they were taken with.',
    '编辑分类': 'Edit category',
    '消费分类已更新': 'Expense category updated',
    '消费分类已创建': 'Expense category created',
    '编辑消费分类': 'Edit expense category',
    '内置': 'Built-in',
    '新增标签（回车添加）': 'New tag (Enter to add)',
    '添加': 'Add',
    '条记录未归到本分类': 'records missing this category',
    '至少需要一个标签': 'At least one tag is required',
    '「{p1}」已不在标签列表中，保存后将清空 {p2} 条记录上的归类。': '“{p1}” is no longer in the tag list; saving clears it from {p2} records.',
    '只想改名的话，长按那枚标签即可（会保留归类）。': 'To rename only, press and hold that tag; records keep their tag.',
    '确认删除分类「{p1}」？该分类下{p2}的标签关联也会被移除。': 'Delete category “{p1}”? Its {p2} tag assignments are removed too.',
    '分类已删除': 'Category deleted',
    '内置分类不可修改': 'Built-in categories cannot be edited',
    '标签已存在': 'Tag already exists',
    '标签已添加': 'Tag added',
    '至少保留一个标签': 'Keep at least one tag',
    '标签已移除': 'Tag removed',
    '标签已重命名': 'Tag renamed',
    '标签名称': 'Tag name',
    '全部时间': 'All time',
    '本月已有记录，无需重复记录': 'This month is already recorded',
    '本月数据已覆盖更新': 'This month’s snapshot was replaced',
    '快照已记录': 'Snapshot saved',
    ' 已记录 ✓': ' recorded ✓',
    '覆盖更新': 'Replace',
    '记录本月数据': 'Record this month',
    '本月已有记录，确定覆盖更新为当前数据？': 'This month is already recorded. Replace it with the current data?',
    '确认删除该月快照？': 'Delete this month’s snapshot?',
    '快照已删除': 'Snapshot deleted',
    '变动': 'Change',
    '变动 %': 'Change %',
    '总净值: ': 'Total: ',
    '该快照没有资产记录': 'This snapshot has no assets',
    '{p1} 项资产 | 合计 ': [ '{p1} asset | Total ', '{p1} assets | Total ' ],
    '折算 CNY': 'in CNY',
    '该标签下没有资产': 'No assets with this tag',
    '至少需要两个月的快照才能对比': 'Comparing needs at least two months of snapshots',
    '两个月份均无资产记录': 'No assets in either month',
    '期初': 'Opening',
    '期末': 'Closing',
    '新增': 'Added',
    '移除': 'Removed',
    '首月': 'First month',
    '较上月 ': 'vs last month ',
    '无备注': 'No note',
    '导入示例数据将覆盖当前所有数据，确认继续？': 'Loading sample data replaces everything. Continue?',
    '资产类型': 'Asset type',
    '活期现金': 'Cash',
    '定期存款': 'Term deposit',
    '权益基金': 'Equity fund',
    '债券基金': 'Bond fund',
    '银行理财': 'Bank product',
    '风险等级': 'Risk level',
    '低风险': 'Low risk',
    '中风险': 'Medium risk',
    '高风险': 'High risk',
    '招商银行活期': 'CMB savings',
    '工商银行定期': 'ICBC term deposit',
    '沪深300指数': 'CSI 300 index',
    '标普500ETF': 'S&P 500 ETF',
    '纯债基金A': 'Pure bond fund A',
    '招行理财': 'CMB product',
    '汇丰香港储蓄': 'HSBC HK savings',
    '初始配置': 'Initial setup',
    '小幅加仓': 'Added a little',
    '市场波动': 'Market swing',
    '补仓操作': 'Topped up',
    '分红再投': 'Dividends reinvested',
    '季度调整': 'Quarterly rebalance',
    '示例数据已导入（6个月快照）': 'Sample data loaded (6 months of snapshots)',
    '当前组合没有现金流收益——调高资产的现金比例后，这里开始计量': 'No cash income yet. Raise an asset’s cash share and it starts counting here.',
    '覆盖 ': 'Covers ',
    '/月': '/mo',
    '已完全覆盖预期月消费': ' fully covers expected monthly spend',
    '已覆盖': 'Covered',
    '当前资产的实际年化不高，加本金也补不上这个缺口——先调高预期年利率或降低月消费。': 'The actual annual return is too low for more principal to close this gap. Raise expected rates or lower monthly spend.',
    '按当前实际年化 {p1}% 线性外推，还需本金 ': 'At the current {p1}% actual return you need another ',
    ' 才能覆盖。': ' to cover it.',
    '还需多少本金才能覆盖': 'How much principal is needed to cover it',
    '月消费（自定）': 'Monthly spend (custom)',
    '先去「分类管理」建一个资产分类和标签。': 'Create an asset category and tags under Categories first.',
    '勾选标签后这里显示结果': 'Pick tags and the result appears here',
    '先设定预期月消费，再回来看结果': 'Set expected monthly spend first, then come back',
    '{p1} ÷ 月消费 {p2} = {p3}': '{p1} ÷ monthly spend {p2} = {p3}',
    '已更新标签与月消费': 'Tags and monthly spend updated',
    '已更新标签': 'Tags updated',
    '加权平均利率 {p1}% · 平均现金收益率 {p2}% · 总资产 {p3}': 'Weighted avg. rate {p1}% · avg. cash yield {p2}% · total assets {p3}',
    ' · 已按 {p1}% 安全边际折算': ' · discounted by {p1}% safety margin',
    '年利率': 'Rate',
    '现金比例': 'Cash',
    '年收益': 'Income/yr',
    '月收益': 'Income/mo',
    '现金/月': 'Cash/mo',
    '* 已按 {p1}% 安全边际折算': '* discounted by {p1}% safety margin',
    '月现金收益': 'Monthly cash income',
    '月总收益': 'Monthly total income',
    '月现金收益 ': 'Cash/mo ',
    '月总收益 ': 'Total/mo ',
    '利率 ': 'Rate ',
    '现金 ': 'Cash ',
    '占比 ': 'Share ',
    '当前浏览器不支持选择文件夹，备份将下载到「下载」文件夹': 'This browser cannot choose folders; backups download to your Downloads folder',
    '已选择备份文件夹「{p1}」': 'Backup folder set to “{p1}”',
    '选择文件夹失败': 'Could not choose a folder',
    '已清除备份文件夹': 'Backup folder cleared',
    '备份': 'Backup',
    '距上次备份已 {p1} 天，记得导出一份': 'Last backup was {p1} days ago; export a copy',
    '已关闭自动备份': 'Auto backup is off',
    '自动备份：{p1}': 'Auto backup: {p1}',
    '数据已导入': 'Data imported',
    '文件格式不正确': 'Wrong file format',
    '解析文件失败': 'Could not parse the file',
    '全部标签': 'All tags',
    '（暂无标签）': '(no tags yet)',
    '匹配「{p1}」': 'matching “{p1}”',
    '{p1}暂无消费记录': 'No expenses {p1}',
    '暂无消费记录': 'No expenses',
    '换个关键词试试，或清除筛选': 'Try another keyword, or clear the filters',
    '复制': 'Duplicate',
    '匹配': 'Matching',
    '合计': 'Total',
    '编辑消费': 'Edit expense',
    '复制消费': 'Duplicate expense',
    '请选择日期': 'Pick a date',
    '金额必须大于 0': 'Amount must be greater than 0',
    '消费已更新': 'Expense updated',
    '消费已记录': 'Expense added',
    '确认删除该消费记录？': 'Delete this expense?',
    '（无备注）': '(no note)',
    '（未命名）': '(untitled)',
    ' 条记录分类不完整 · 缺 ': ' records are missing tags · missing ',
    ' 条待归类': ' to tag',
    '✓ 已补齐 {p1} 条': '✓ Tagged {p1}',
    '点标签即生效': 'A click applies at once',
    '一键补齐：': 'Fill all:',
    '已为 {p1} 条记录打上「{p2}」': 'Tagged {p1} records “{p2}”',
    '已归入「{p1}」': 'Filed under “{p1}”',
    '请输入有效的预期消费金额': 'Enter a valid expected monthly amount',
    '预期消费已更新': 'Expected spend updated',
    '预期消费已设置': 'Expected spend set',
    '已清除预期消费': 'Expected spend cleared',
    '预期 ¥': 'Expected ¥',
    '设定预期': 'Set expected',
    '预期 ': 'Expected ',
    '{p1} 条消费记录': [ '{p1} expense', '{p1} expenses' ],
    '至少需要两个月的消费记录才能对比': 'Comparing needs at least two months of expenses',
    '该维度下暂无标签': 'No tags in this dimension',
    '分类标签': 'Tag',
    '期初月': 'Opening month',
    '期末月': 'Closing month',
    '月度消费明细': 'Monthly expenses',
    '总消费: ': 'Total: ',
    '{p1} 笔记录': [ '{p1} entry', '{p1} entries' ],
    '该月没有消费记录': 'No expenses this month',
    '{p1} 笔记录 | 合计 ': [ '{p1} entry | Total ', '{p1} entries | Total ' ],
    '该标签下没有消费记录': 'No expenses with this tag',
    '导入示例数据将覆盖当前所有消费数据，确认继续？': 'Loading sample data replaces all current expenses. Continue?',
    '消费类别': 'Expense category',
    '餐饮': 'Dining',
    '交通': 'Transport',
    '购物': 'Shopping',
    '住房': 'Housing',
    '娱乐': 'Entertainment',
    '医疗': 'Health',
    '教育': 'Education',
    '其他': 'Other',
    '支付方式': 'Payment method',
    '微信': 'WeChat',
    '支付宝': 'Alipay',
    '现金': 'Cash',
    '银行卡': 'Card',
    '消费频率': 'Frequency',
    '日常': 'Routine',
    '偶尔': 'Occasional',
    '一次性': 'One-off',
    '午餐外卖': 'Takeout lunch',
    '地铁通勤': 'Metro commute',
    '超市采购': 'Groceries',
    '房租': 'Rent',
    '电影票': 'Movie tickets',
    '药房买药': 'Pharmacy',
    '网课订阅': 'Online course',
    '咖啡': 'Coffee',
    '打车': 'Taxi',
    '衣服': 'Clothes',
    '水电费': 'Utilities',
    '游戏充值': 'Game top-up',
    '理发': 'Haircut',
    '示例消费数据已导入（': 'Sample expenses loaded (',
    '个月）': ' months)',
    '{y}年{m}月': '{y}-{m}',
    '{label}，已按{dir}排列': '{label}, sorted {dir}',
    '升序': 'ascending',
    '降序': 'descending',
    '长按 {sec} 秒进入资产页': 'Press and hold for {sec}s to open assets',
    '换英文': 'Type English instead',
    '换中文': 'Type Chinese instead',
    '盈余': 'Surplus',
    '缺口': 'Shortfall',
    '不足 1 个月': 'Less than a month',
    '{n} 个月': [ '{n} month', '{n} months' ],
    '{y} 年': [ '{y} year', '{y} years' ],
    '{y} 年 {m} 个月': '{y} yr {m} mo',
    '已超预算 {p1} · 本月额度已用完': 'Over budget by {p1} · nothing left this month',
    '预算剩 {p1} · 余 {p2} 天 · 日均 {p3}': '{p1} left · {p2} days to go · {p3}/day',
    '月份图': 'Month',
    '笔数': 'Entries',
    '明细': 'Details',
    '上个月': 'Previous month',
    '下个月': 'Next month',
    '一': 'Mon', '二': 'Tue', '三': 'Wed', '四': 'Thu', '五': 'Fri', '六': 'Sat', '日': 'Sun',
    '点一格看当天的记录，长按一格记一笔': 'Tap a day to see its entries; press and hold to add one',
    '已连续 {n} 天没有记录': 'No entries for {n} days straight',
    '记账中断提醒': 'Gap reminder',
    '连续这么多天一笔都没记时，在消费页的月份图上提一句；填 0 关掉。': 'Flag it on the month grid once this many days pass without an entry; 0 turns it off.',
    '连续没记账天数': 'Days without an entry',
    '消费小票': 'Spending receipt',
    '小票': 'Receipt',
    '小票已导出': 'Receipt exported',
    '小票已打开，可另存为': 'Receipt opened — save it if you want',
    '谢谢惠顾': 'Thank you',
    '{n} 件': '{n} items',
    '{n} 笔': '{n} entries',
    '这天没有记录': 'No entries that day',
    '{m} 月 {d} 日': '{m}/{d}',
    '回到上一次': 'Restore last',
    '压测已清除 · 可回到上一次': 'Stress cleared · restore available',
    '压测已恢复': 'Stress restored',
    '货币类型': 'Currency',
    '尚未备份过': 'No backup yet',
    '上次备份 {p1}（今天）': 'Last backup {p1} (today)',
    '上次备份 {p1}': 'Last backup {p1}',
    ' → 「{p1}」': ' → “{p1}”',
    '今日自动备份': 'Today’s auto backup',
    '导出备份': 'Export backup',
    '{head}：{name}{where}': '{head}: {name}{where}',
    '导出失败，请重试': 'Export failed; try again',
    '已取消备份': 'Backup cancelled',
    '已开始下载，请在下载栏确认': 'Download started; check your downloads',
    '已自动备份': 'Auto-backed up',
    '到「{p1}」': ' to “{p1}”',
    '数据已导出': 'Data exported',
    '未选择，文件窗口默认打开上次的目录': 'Not chosen; the save dialog opens where you saved last',
    '已选择「{p1}」，文件窗口默认打开这里': '“{p1}” chosen; the save dialog opens here',
    '已选择「{p1}」，但当前浏览器不支持指定目录，文件窗口从默认位置打开': '“{p1}” chosen, but this browser cannot target folders; the save dialog opens at the default location',
    '使用缓存汇率': 'Using cached rates',
    '汇率获取失败': 'Exchange rates unavailable',
    '导出密钥': 'Export passphrase',
    '导出与自动备份存成密文；导入时要输入这串密钥。密钥只在本机，忘了就打不开。': 'Exports and auto backups are encrypted; importing asks for this passphrase. It stays on this device — forget it and the files stay shut.',
    '更换密钥': 'Change passphrase',
    '导出加密': 'Encrypted export',
    '导出明文': 'Plain-text export',
    '保存密钥': 'Save passphrase',
    '密钥': 'Passphrase',
    '密钥至少 {p1} 位': 'Use at least {p1} characters',
    '已设置导出密钥，之后的导出都会加密': 'Passphrase saved; exports will be encrypted',
    '保存失败：浏览器不允许本地存储': 'Could not save: this browser blocks local storage',
    '确认清除导出密钥？清除后导出的是明文文件；已加密的备份仍要原密钥才能打开。': 'Clear the export passphrase? Exports become plain text; encrypted backups still need the old passphrase.',
    '已清除导出密钥': 'Export passphrase cleared',
    '输入密钥': 'Enter passphrase',
    '这个备份是加密的，输入导出时用的那串密钥才能打开。': 'This backup is encrypted; enter the passphrase used when exporting it.',
    '解密': 'Decrypt',
    '密钥不对，或文件已损坏': 'Wrong passphrase, or the file is damaged',
    '解开了，但里面不是账本 JSON': 'Decrypted, but that is not a ledger JSON',
    '导出失败：{step}这一步没成功': 'Export failed at {step}',
    '导出失败：{step}这一步没成功（{p1}）': 'Export failed at {step} ({p1})',
    '打开保存窗口': 'the save dialog',
    '加密': 'encryption',
    '写文件': 'writing the file',
    '保存窗口给回来的句柄不能用（被扩展或浏览器改过），换个浏览器再试': 'The save dialog returned an unusable handle (changed by an extension or the browser). Try another browser',
    '这个页面不是安全环境（https 或 localhost），不能加密；换地址打开，或先清空导出密钥': 'This page is not a secure context (https or localhost), so it cannot encrypt. Open it via a secure address, or clear the export passphrase first',
    '浏览器没允许打开保存窗口（多半是扩展或策略拦下了），换 Chrome / Edge 或先清空「备份文件夹」再试': 'The browser blocked its save dialog (usually an extension or a policy). Try Chrome / Edge, or clear the backup folder first',
    '这个文件现在写不进去（可能正被其他程序打开），换个位置再试': 'That file cannot be written right now (it may be open in another app). Pick another location',
    '浏览器不允许写入这个位置，换一个文件夹再试': 'The browser cannot write to that location; pick another folder',
    '磁盘没有空间了，无法写入': 'Out of disk space; nothing was written',
    // 月度快照提醒（文案只报月份，不报金额）
    '快照提醒': 'Snapshot reminder',
    '本月快照还没记。上次快照：{p1}。在「资产 → 历史净值」记录本月快照，净值曲线才连得上。':
      'No snapshot for this month yet. Last one: {p1}. Record it under Assets → Net worth history so the curve stays continuous.',
    '本月快照还没记。还没有任何月度快照。在「资产 → 历史净值」记录本月快照，净值曲线才连得上。':
      'No snapshot for this month yet — and none at all so far. Record it under Assets → Net worth history so the curve has a starting point.',
    '本月还没记录快照时，打开页面提醒一次；同一天最多提醒一次，记完本月就不再出现。':
      'Reminds you once when this month has no snapshot. At most once a day, and it stops as soon as this month is recorded.',
    '快照提醒时机': 'Snapshot reminder timing',
    '月初后': 'After day',
    '月末前': 'Last',
    '快照提醒天数': 'Snapshot reminder days',
    '天': 'days',
    '知道了': 'Got it',
  };

  // 页面不直接调用、但被单测逐条断言的内部件也留在域里（删掉导出等于删掉那些断言的接缝）。
  // 按域分组：页面与单测都经域名访问（如 text.esc），新增函数先想清楚属于哪个域。
  return {
    i18n: {
      t,
      normalizeLang,
      langTag,
      flatpickrLocale,
      I18N_LANGS,
      I18N_DEFAULT,
      I18N_EN,
    },
    money: {
      toCNY,
      formatCNY,
      money2,
      moneyStr,
      parseMoneyInput,
      amountAtRates,
      sumAmountCNY,
      pctStr,
    },
    date: {
      addMonths,
      getCurrentMonth,
      getLocalDateStr,
      getLocalMonthStr,
      monthLabel,
      monthsDesc,
      daysBetweenStr,
      daysInMonthOf,
    },
    text: {
      esc,
      escRegExp,
      jsAttr,
      truncateLabel,
      highlightMatch,
    },
    color: {
      hexToRgba,
      hexToHsl,
      hslToHex,
      pillColors,
      basePill,
      CATEGORY_COLORS,
      CATEGORY_PALETTE,
      CHART_INK,
      shadeAt,
    },
    chartData: {
      buildSunburstData,
      nodeValue,
      childCount,
      sunburstLegendRows,
      sunburstDrillView,
      sunburstNodePath,
      percentSeriesData,
      pruneLegendSelected,
      sortTagsByTotal,
    },
    snapshot: {
      findMonthSnapshot,
      getPrevSnapshot,
      defaultCompareBaseMonth,
      shouldRemindSnapshot,
      snapshotReminderText,
      normalizeSnapshotReminder,
      SNAPSHOT_REMINDER_MAX_DAYS,
      SNAPSHOT_REMINDER_DEFAULT_DAYS,
    },
    receipt: {
      model: receiptModel,
      fileName: receiptFileName,
    },
    monthGrid: {
      countLevel,
      amountLevel,
      dayTotals,
      build: monthGrid,
      cellValue,
      cellText: monthGridCellText,
      dayEntries,
      monthEntries,
      shortCNY,
    },
    expense: {
      gapDays,
      normalizeGapDays,
      GAP_DAYS_DEFAULT,
      GAP_DAYS_MAX,
      expenseMonths,
      monthlyExpenseTotals,
      prevExpenseMonthOf,
      expenseMoM,
      expenseMonthTagTotals,
      monthExpenseTotal,
      monthBudgetReading,
      monthBudgetNote,
      tagFilterValue,
      parseTagFilter,
      expenseTagFilterGroups,
      hasTagFilterOption,
      normalizeExpenseFilters,
      applyExpenseFilters,
      expenseListView,
      isUntaggedItem,
      missingTagGroups,
      setTag,
      backfillTag,
      migrateTagRefs,
      countTagRefs,
    },
    income: {
      getAssetRate,
      getSafetyFactor,
      getCashRatio,
      calcAssetIncome,
      hasAnyRatedAsset,
      cashRatioPct,
      coveragePct,
      incomeGap,
      coverShortfallPrincipal,
      sumAssetIncomes,
      ratedPrincipalCNY,
      pruneRunwayTags,
      migrateRunwayTagRefs,
      runwayLiquidCNY,
      runwayExpectationOf,
      runwayExpectationIsCustom,
      normalizeRunwayExpectationInput,
      runwayMonths,
      runwayMonthsText,
    },
    backup: {
      BACKUP_STALE_DAYS,
      normalizeBackupFreq,
      backupNoteText,
      hasAnyBackupWorthyData,
      shouldAutoBackup,
      backupStaleDays,
      backupJSONText,
      backupFileName,
      backupPromptText,
      backupWritePlan,
      backupResultNotice,
      backupDirNoteText,
      rateFallbackNotice,
      ratesFromApi,
      exportErrorNotice,
    },
    vault: {
      BACKUP_ENC_FORMAT,
      BACKUP_ENC_VERSION,
      BACKUP_KDF_ITERATIONS,
      BACKUP_PASSPHRASE_MIN,
      passphraseTooShort,
      isEncryptedBackup,
      backupModeText,
      encryptBackup,
      decryptBackup,
    },
    stress: {
      stressDimensions,
      stressKeepRows,
      stressBarText,
      normalizeKeepPct,
      keepOfEntry,
      pruneStress,
      stressActive,
      stressKeepOf,
      stressDropOf,
      effectiveAssets,
      unclassifiedCNY,
      weightedDrop,
      migrateStressTagRefs,
    },
    migrate: {
      migrateState,
    },
    category: {
      parseTagInput,
    },
    demo: {
      assetDemo,
      expenseDemo,
    },
    // 域名就叫 motion，不叫 chart：页面里 `chart` 是 ECharts 实例的变量名，
    // 同名域会被局部变量遮蔽（`chart.motion(...)` 会在实例上找方法——实翻过，整页图表全灭）。
    motion: {
      chartMotion,
    },
    ui: {
      nextSortState,
      inlineEditKeyAction,
      activateKeyAction,
      sortAriaSort,
      sortAriaLabel,
      trapFocus,
      toastLiveMode,
      moveAssetIndex,
      AUTO_OPEN_GUARD_MS,
      autoOpenGuard,
      MODE_PRESS_MS,
      modePressProgress,
      modePressDecision,
      modePressHint,
      ENTRY_PHRASES,
      entryPhrase,
      entryPhraseMatches,
      TAG_PRESS_MS,
      pressProgress,
      pressDecision,
      lampEnabled,
      lampPos,
      shouldPinSelectWidth,
      tipBubblePos,
      TIP_GAP,
      TIP_EDGE,
      paneEnterShift,
    },
  };
});
