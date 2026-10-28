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
  // 三态循环：同列点击 升序 → 降序 → 取消排序（恢复自然/拖拽顺序）；换列则重置为新列升序。
  // 资产 toggleSort 与消费 toggleExpenseSort 共用同一状态机；
  // flipSticky=true 表达消费侧「首次点击保留旧行为」的粘性翻转（仅翻转方向、不进入循环），
  // 由调用方负责翻回 touched 标记。返回新 {by, dir}，不修改入参
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

  // 行级激活的键位语义（单一来源）：role="button" 的元素被期望同时响应 Enter 与 Space
  // （WAI-ARIA 惯例，缺一不可）。只认 Enter 是常见的半吊子实现——用键盘的人按 Space
  // 毫无反应，而 Space 恰恰是屏幕阅读器用户最惯用的激活键。
  // Tab/Esc/方向键必须放行：Tab 是焦点移动、Esc 是关弹窗、方向键是滚动，
  // 吃掉它们比「少支持一个键」更糟——那是把键盘用户困在原地。
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

  // 排序列头对读屏器的表述（可访问名）。
  // 为什么不能只靠 aria-sort：表头是 role="button"（不是 columnheader），而 aria-sort
  // **按 WAI-ARIA 规范未定义在 button 上**——实测 Chrome 的 AX 树里那枚属性不产生任何 sort 信息
  // （原生 <th aria-sort> 也一样测不出），即「属性写上了、读屏器收不到」。
  // 真正到达读屏器的是**可访问名**，故把方向写进去；同时保留可见列名在前
  // （WCAG 2.5.3「名称包含可见文字」：否则语音控制用户喊不出这一列）。
  function sortAriaLabel(label, by, dir, field) {
    if (!by || by !== field) return '';
    if (dir !== 'asc' && dir !== 'desc') return ''; // 脏值不误报方向
    return t('{label}，已按{dir}排列', { label: label, dir: t(dir === 'desc' ? '降序' : '升序') });
  }

  // ===== 进入资产页的门槛：长按 + 抄写 =====
  // 目的不是权限，是给「顺手看一眼」定价（资产价格短期波动天然大，高频查看只会
  // 放大情绪噪音）。两段闸：
  //   ① 指针路径上按住「资产」满 MODE_PRESS_MS——只挡顺手一点；
  //   ② 抬闸后抄一句随机箴言——每次进入都要付，且无法被肌肉记忆抹平。
  // 键盘/读屏器不付①（按住 Enter 会按键重复，计时不可信），但②对所有人同价：
  // 门槛的价格不能取决于你用什么设备。
  // 阈值、进度比例与「按满/仅提示」判定都收在这里：文案要报时长，判定要用时长，
  // 分散在页面里改一处忘一处就会出现「文案说 1.2 秒、实际 1 秒」这类漂移。
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

  // 松手处置：'done' = 动作成立；'short' = 短按（教学/无动作）；'ignore' = 没按
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

  // 门槛箴言池（复制粘贴=0）：抬闸后要现场抄写其中一句。
  // 两池**各用母语写、互不翻译**——译文腔读起来像考试题，也会把「无常」这层意思磨平。
  // 硬约束（由单测把关）：句数相等、长度等价（中文 ≤10 字 / 英文 ≤24 字符）、
  // 两池都不含标点。否则换个界面语言就顺手改了门槛的价钱，或者全角/半角逗号
  // 打错变成一次无意义的失败。
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

  // 悬停提示气泡的视口坐标（气泡用 position: fixed 挂在视口上，不挂在 ? 图标上）。
  //
  // 为什么要脱离祖先：卡片自身有 backdrop-filter，于是**自成层叠上下文**——气泡的 z-index
  // 只在卡片内部有效，后面那张卡片在文档里更靠后，就整块盖上来（用户实测：收益测算里
  // 「缺口」旁的气泡下半被下面的表格盖住）。弹窗正文的 overflow-y:auto 与窄屏表格的
  // overflow-x:auto 也会直接裁掉溢出的气泡。fixed 定位一次解决这两类。
  //
  // 三条约束：默认落在锚点下方并与锚点左对齐；下方放不下就翻到上方；右侧放不下就向左收
  // （始终夹在视口内——越界只会让气泡消失或凭空多出横向滚动条）。
  // 锚点矩形、气泡尺寸与视口都由调用方量好传进来，本函数只管算术，故可单测。
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

  // 是否需要这盏灯：减动效（明确要求安静）/ 粗指针（触屏没有悬停，徒耗性能）/ 页面不可见
  // 三种情况都不跟。判定为纯函数，DOM 层只负责把三个信号取出来。
  // 灯该不该亮：四种「不跟」的情况（减动效/触屏/页面不可见/弹窗开着）。
  // 弹窗开着不跟：背景已被磨砂推远，光还在底下逐帧重算，既看不见又白花一次全屏渐变；
  // 且「界面上只有最上层是活的」这条承诺在光的层次上也该成立。
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

  // ========== 消费标签筛选（分组下拉，纯函数）==========
  // 下拉形态：类别作 optgroup 分组头（不可选），标签为可选项。选中值编码 catId + SEP + tag，
  // 由 parseTagFilter 解回 { catId, tag }，DOM 侧不自行拼/拆口径（防两处漂移）。
  // 分隔符取控制字符：分类 id 由 genId() 生成、标签为用户输入，均不含 \u0001；
  // 解析取首个分隔符，标签自身即使含分隔符也会原样保留在 tag 里
  const TAG_FILTER_SEP = '\u0001';

  function tagFilterValue(catId, tag) {
    return String(catId == null ? '' : catId) + TAG_FILTER_SEP + String(tag == null ? '' : tag);
  }

  // 空值 / 缺分隔符 / 空分类 id（分隔符在首位）/ 空标签 → null，视作未筛选
  function parseTagFilter(value) {
    const v = String(value == null ? '' : value);
    const i = v.indexOf(TAG_FILTER_SEP);
    if (i <= 0) return null;
    const tag = v.slice(i + 1);
    if (!tag) return null;
    return { catId: v.slice(0, i), tag: tag };
  }

  // 分类列表 → 下拉分组结构（保持分类顺序；tags 缺失归空数组），index.html 据此渲染 optgroup
  function expenseTagFilterGroups(categories) {
    return (categories || []).map(c => ({
      id: c.id,
      name: c.name,
      tags: ((c || {}).tags || []).slice(),
    }));
  }

  // 选中值仍是有效选项吗：分类被删 / 标签被改名或移出后据此回落「全部标签」
  function hasTagFilterOption(groups, value) {
    const p = parseTagFilter(value);
    if (!p) return false;
    return (groups || []).some(g => g.id === p.catId && ((g || {}).tags || []).indexOf(p.tag) >= 0);
  }

  // ========== 消费筛选（三段叠加 + 空态判据，唯一所有者）==========
  // 页面不再持有镜像变量，也不从控件读回：控件只写、渲染只读这一份状态。
  // 失效值（月份已无记录 / 标签已改名或移出）在归一阶段丢弃，因此不存在
  // 「先重建下拉、再读值」的次序依赖——那个次序在旧实现里真实写反过一次，
  // 表现为「下拉=全部时间 / 空态=该月无记录」的自相矛盾中间态。
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

  // 三段互相独立、可叠加；顺序保持入参原序（排序由调用方决定）
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

  // ========== 标签改名的引用迁移 ==========
  // 在分类编辑框里把「活期现金」改成「现金类」，旧名已不在标签列表里——若按「无效引用」清理，
  // 资产/消费上的归类会被静默清空（分布图与读数卡随之失真）。改名必须**迁移引用**，
  // 只有真正被移除的标签才走删除路径。
  // 只迁移恰好命中「同分类 + 同名」的引用，返回迁移条数（供 UI 提示）。
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
  // 覆盖率（%）: 分子月收益 ÷ expectation × 100（分子由调用方按口径选现金或总收益）。
  // expectation 未设/非法（<=0）→ null（无法计量, UI 显示「设定预期」邀请态）；
  // 月收益非法/负数 → 0（防御, 覆盖率从零起量而非 NaN）
  // 形参名 amount 口径无关: 分子可为现金收益或总收益（默认口径为 total）, 勿命名成 cashMonthly 误导调用方
  function coveragePct(amount, expectation) {
    const e = Number(expectation);
    if (!isFinite(e) || e <= 0) return null;
    const c = Number(amount);
    if (!isFinite(c) || c < 0) return 0;
    return c / e * 100;
  }

  // 两口径收益合计（报头副行/收益摘要/覆盖标尺共用, 防多处各算漂移）。
  // 返回 { annual, cashAnnual, monthly, daily, cashMonthly }, 衍生值与单资产算法同式除法;
  // 未设利率资产贡献 0, 空表/缺失入参归零不产出 NaN。
  // 语义约定: 全量累加含负收益资产（表单允许负利率、导入亦不鴴制）——
  // 与报头口径一致; 旧收益摘要曾 filter(annual>0) 剔除负值属口径分裂, 勿回潮
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

  // 覆盖缺口还需本金（线性外推）: 缺口月 ×12 ÷ 实际年化，其中实际年化 = annual ÷ principal。
  // annual/principal 由调用方按口径传入（total: 年总收益/有息本金；cash: 年现金收益/有息本金），
  // 有息本金指 getAssetRate > 0 资产的折算合计（闲置零利率资产不摊薄收益率）；
  // 安全边际已含在 annual 里（calcAssetIncome 折算），min/max 跟随 incomeMode。
  // 返回：已覆盖/打平或预期非法 → null（UI 不挂 Tips）；年收益/基地非法或非正 → Infinity
  // （实际年化 ≤0 无法外推，UI 显示兜底一句）；月收益非法按 0 参与（与 incomeGap 同口径）。
  // 返回 { need, rate }: need 同上（null / Infinity / 金额）; rate 为**实际年化百分比**
  // （annual ÷ principal × 100, 已含安全边际折算），与 need 同源一次算就出 ——
  // 展示层再算一遍 annual/principal 就与外推基数分家（改一处忘另一处不报错）。
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

  // 分子合计（CNY）: 匹配资产的金额按当前汇率折算求和。
  // 标签语义（与筛选面板的维度语义一致, 已按分类分组）:
  //   同一分类内多选 = 或 —— 一个资产在一个分类下只带一个标签, 同分类取交必然为零（如「低风险 + 中风险」）;
  //   不同分类之间 = 且 —— 所选分类都要满足（如「活期现金 + 低风险」只算既是活期又低风险的资产）。
  // 未选标签返回 null —— 与「选了但无资产命中」（0）区分, UI 据此走指引句而不是把「没选」显示成 0
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

  // 分母（月消费）: 先看全局「预期月消费」是否已设 —— 未设则整卡不显示（读数卡入口就在卡内, 自定值也无从填起,
  // 仍然回页头「预期消费」按钮）；已设则自定值优先, 未自定（0/空/非法/负值）回落全局值。
  // 自定值只作用于这张读数卡 —— 不写回 state.expenseExpectation, 趋势参考线/覆盖标尺/进度卡照旧用全局值,
  // 目的就是可以按更保守的月消费看「能撑多久」, 不动全局口径。全局预期未设 → 0（UI 整卡不显示,
  // 即卡内自定值不放行 —— 「先有预期月消费才有这张卡」）。
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

  // 输入框字符串 → 自定月消费值（0 = 未自定/按默认）: 空串、非法、非正数一律 0;
  // 与全局「预期月消费」相同的数也按默认存（0）—— 它会继续跟着全局走, 否则日后改全局预期时
  // 本卡会默默钉住一个看似默认的旧值。
  // 写入侧（saveRunwayTags）与弹窗实时预览共用这一处解析+归一; 读取侧的回落见 runwayExpectationOf。
  // 两侧不得各写一份: 值恰好等价也靠不住, 只改一处就会让预览与保存后的读数分家且不报错。
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

  // ========== 本月预算消耗（趋势页进度读数卡）==========
  // 本月合计（CNY）: 复用 monthlyExpenseTotals 同一容错口径（缺 date / NaN 金额贡献 0）, 不另写一套
  function monthExpenseTotal(expenses, month) {
    const found = monthlyExpenseTotals(expenses).find(x => x.month === month);
    return found ? found.total : 0;
  }

  // 'YYYY-MM' → 当月天数。手动拆解构造 new Date(y, m, 0)（本地时区, 不走 toISOString 的 UTC 偏移）;
  // 年/月非法（含 13 月、0 月）返回 null
  function daysInMonthOf(month) {
    const [y, m] = String(month || '').split('-').map(Number);
    if (!y || !m || m < 1 || m > 12) return null;
    return new Date(y, m, 0).getDate();
  }

  // 本月预算消耗口径（进度卡读数单一来源）——**不用时间进度做对照基准**：
  // 消费沿时间并不均匀（房租这类大额固定支出在月初入账），「比时间进度多花/少花」几乎完全由
  // 那笔支出的入账日决定, 不携带「是否花超了」的信息, 反而会诱导用户把正常支出当异常。
  // 改为两个不依赖均匀假设、直接可决策的数：
  //   remaining = 预期 − 已花（下限 0, 超支时不在剩余里呈现负数）
  //   daysLeft  = 当月天数 − 今天日期号 + 1 —— 今天算整天（与旧的 pace 口径同精神, 不虚报）
  //   dailyLeft = remaining ÷ daysLeft —— 「剩下这些钱、这些天, 每天能花多少」, 分母恒 >= 1
  //   over/excess = 已花 > 预期 / 超出额（打平算不超, 与 incomeGap 打平算盈余同精神）
  //   pctOfMonth  = 已花 ÷ 预期 × 100 —— 真实值不封顶, 封顶是进度条 UI 职责
  // expectation 未设/非法（<=0）→ null（UI 整卡不显示, 入口交给「预期消费」按钮）
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

  // 预算状态文案（#pace-note 唯一渲染出口, 内联脚本不得重复字面量）:
  // 正常 → 剩余 + 余下天数 + 日均; 超支 → 超出额 + 「本月额度已用完」（不显示负的日均）;
  // 打平（remaining 与 excess 都为 0）→ ''（没有可叙述的差额）。金额走 formatCNY 同一货币呈现。
  // 入参可能是脏的/缺字段的（不一定是 monthBudgetReading 的产物）: 本函数读到的每个字段都必须
  // 先验成有限数, 否则 formatCNY(undefined) 会抛 TypeError、formatCNY(NaN) 会渲染出「¥NaN」。
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

  // ========== 数据迁移 / 兜底（依赖全局 state，原地修改）==========
  // loadState（本地加载）与 importData（JSON 导入）共用，保证旧版数据导入后行为一致
  function migrateState() {
    // 语言设置先归一：后面的内置分类名要靠它取词（且 en 缺省时不能靠 t 的副作用）
    state.lang = normalizeLang(state.lang);
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
        // 与图表聚合共用同一折算口径（amountAtRates 的容错），不在此另写一份 reduce
        s.totalCNY = sumAmountCNY(s.assets, s.currencyRates || state.rates);
      }
    });
    // ensure categories/assets arrays
    if (!Array.isArray(state.categories)) state.categories = [];
    if (!Array.isArray(state.assets)) state.assets = [];
    // ensure currency category exists
    if (!state.categories.find(c => c.id === 'currency')) {
      // 名称只在**创建那一刻**取当前语言：分类名是用户数据，之后不随语言切换改写
      state.categories.unshift({ id: 'currency', name: t('货币类型'), builtin: true, tags: ['CNY', 'HKD', 'USD'] });
    }
    // ensure rates object（导入数据可能缺失或损坏）
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
    // 用户设置字段（旧数据/导入数据可能缺失或为字符串）
    // 数字归一：字符串会让 formatCNY 走 String.toLocaleString 丢掉两位小数，统一转数字
    state.expenseExpectation = Number(state.expenseExpectation) || 0;
    state.netWorthTarget = Number(state.netWorthTarget) || 0;
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
    // init expense data
    if (!Array.isArray(state.expenses)) state.expenses = [];
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

  // 单标签/无标签时取分类基色；暗色下转为同色相深底浅字
  function basePill(base, dark) {
    return dark ? pillColors(base, 0, true) : { ...base };
  }

  // ========== 图表数据构造（纯，可单测）==========
  // 旭日图 / 堆叠柱调色板：资产/收入/消费/历史/趋势五图共用同一套暖色配色。
  // 原定义在 index.html，迁移至此处以便逻辑与单测共用同一份数据源。
  // 图表色板（旭日图/堆叠柱共用）。条目三个字段各有契约：
  //   base  内环分类基色
  //   label 印在**内环**上的字色——不是固定白字：琥珀/铜这类浅底上白字只有 2.3:1，
  //         得改用墨字。早先字色写死在 buildSunburstOption 里（color: '#fff'），实测 10 个
  //         基色有 7 个不达 AA；收进表里才能被单测逐条钉住（同 CATEGORY_COLORS 的思路）。
  //   shades 外环条目三阶：同色相浅阶、彼此明度差 ≥5%（兄弟条目要看得出来）
  // 外环浅阶一律用 CHART_INK（墨）——浅底上白字只有 2.0~3.7:1，两种环的字色天然不同。
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

  // 旭日图数据构造（资产/收入/消费三图共用）：给定分类与「按标签分组的子项数组」，
  // 统一套用 CATEGORY_PALETTE 配色。childValue(child) 决定扇区数值；
  // child 可携带 extra 字段（如 _assetId）透传到 ECharts 节点。数值统一四舍五入两位。
  // **字色写在节点上（label.color）**，不靠 levels[].label.color 的回调：实测 ECharts 5
  // 对 sunburst 层级 label 的函数型 color 不保证逐节点求值（本项目的真实图上量到 2.15:1，
  // 说明回调没生效、退回默认黑字）；节点级静态色则确定生效。写在数据里还有个好处：
  // 色与字仍同表（CATEGORY_PALETTE.label / CHART_INK）且可被单测直接断言。
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

  // 旭日图的「视图」：喂给图的数据与占比分母，由清单的选中态派生。
  // 为什么不让 ECharts 自己下钻（nodeClick:'rootToNode'）：那会引入**第二套**视图状态——
  // 图的 viewRoot 与清单的选中态各自为政，于是「‹ 全部分类」只清了清单、图仍停在下钻层
  // （用户实测：「返回到整个全景的时候，依然展示的是具体分类的值」）。
  // 改成一个派生函数后，图与清单读的是同一份选中态，不可能再漂。
  //   · 未选中（null/''/undefined，或指向已不存在的分类）→ 原样返回全量 + 调用方的筛选合计；
  //   · 选中 → 只喂该分类（图的内环就是它，外环是它的条目），分母换成该分类合计
  //     （与清单条目级占比同源，条目加起来正好 100%）。
  // 不改写入参：未选中时直接复用入参数组（每帧重建一份没意义，也会让 ECharts 重排）。
  function sunburstDrillView(data, total, selected) {
    const list = Array.isArray(data) ? data : [];
    const sel = selected ? list.find(n => n && n.name === selected) : null;
    if (!sel) return { data: list, total: Number(total) || 0 };
    return { data: [sel], total: nodeValue(sel) };
  }

  // 占比百分比字符串（1 位小数），用于图表 tooltip / 标签；分母为 0 时返回 '0.0'
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

  // 旭日图节点在**扁平化树**里的下标（ECharts 的 dataIndex 就是这一套）。
  // 实测（真实 ECharts 5）：点内环分类返回 dataIndex = 顶层下标 + 1，因为虚拟根占了 0；
  // 于是「分类 N」= 1 + N，「分类 N 下的第 k 个条目」= 2 + N + k（前面的兄弟分掉了序号）。
  // 不换算就会差一个：悬停清单第一行会高亮到隔壁扇区（这个 bug 曾真的发生）。
  // 越界一律 null：调用方据此跳过 highlight，而不是乱亮一个不相干的扇区。
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

  // 旭日图右侧清单的数据：**未选中**时列顶层分类；**选中某分类**时列它下面的条目。
  // 需求原话：「选中其中一个层级的时候，他右边的标签可以联动成选中的当前分类下的一些标签」。
  // 三点口径：
  //   ① selected 指向不存在的分类（被删掉/换了维度）→ 回落为顶层列表，不留悬空状态；
  //   ② 条目级占比的**分母是该分类合计**（条目加起来正好 100%），不是全局合计；
  //   ③ 每条带 idx / path，供「清单 → 扇区」高亮定位（path 交给 sunburstNodePath 换算）。
  // 不改写入参：入参就是喂给 echarts 的同一份 data。
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
    if (!lastBackup) return t('尚未备份过');
    return lastBackup === today
      ? t('上次备份 {p1}（今天）', { p1: lastBackup })
      : t('上次备份 {p1}', { p1: lastBackup });
  }

  // 方案 A 决策：今天是否该弹一次自动备份确认框。
  // off / 无数据 → 否；从未备份或历史日期损坏(gap==null) → 是；
  // daily 当天已备份过(gap<=0) → 否；weekly 不足 7 天(gap<7) → 否。
  // 只看 lastBackup（确认写入才更新）：取消/回退下载一律不算「备份过」，当天再进来仍会再问一次。
  // backup 对象缺失时按默认 daily + 从未备份处理（与 migrateState 兑底一致）
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

  // 落点决策：**一律过系统文件窗口**（能弹 → file），弹不出来才回退浏览器下载。
  // 为什么不再「目录已授权就静默写」：跨会话的目录写权限靠不住（Chrome 的授权只撑到关闭该 origin
  // 最后一个标签页，重开后 queryPermission 就是 prompt），而自动备份跑在定时器里没有用户手势、
  // 无法申请授权——结果是「设置了文件夹却仍在弹下载框」。现在统一：先弹确认框（用户点击 =
  // 手势），再开文件窗口，位置由 startIn（设置里选的目录）决定。
  // 缺省参数按「弹不出」保守处理，调用方漏传不会误写。
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

  // ========== 汇率刷新提示决策 ==========
  // 拉取失败时的便条文案与类型：有缓存可回退 → info「使用缓存汇率」（中性金墨边注，注意但不报警）；
  // 连缓存都没有 → error「汇率获取失败」（报警红）。fetchRates 的 catch 只做 DOM 副作用，
  // 分支决策抽在此保持纯净可测
  function rateFallbackNotice(hasCache) {
    return hasCache
      ? { msg: t('使用缓存汇率'), type: 'info' }
      : { msg: t('汇率获取失败'), type: 'error' };
  }

  // 汇率响应的**形状校验**：API 给的是「1 CNY = X 外币」，页面要取倒数写成「1 外币 = X CNY」。
  // 原先直接 1 / cny.hkd：字段缺失得 NaN、给 0 得 Infinity，两者都会写进 state.rates 并落盘——
  // 此后每张表、每个合计都是 NaN / Infinity，而便条还说「汇率已更新」。故这里先验，
  // 任一币种不是有限正数就整体拒绝（返回 null，调用方走既有的 catch 回退分支）。
  // 不逐个「能用的用、不能用的留旧值」：一次响应里只有一半可信时，混着用的口径比全旧更难解释。
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
  // 便条容器原先写死 aria-live="polite"：所有知会（含 22 处 error）都排队等读屏器空闲才念。
  // 但 error 的语义就是「出错了、等你处理」——排队到用户下一次操作之后才念，
  // 等于把「现在就得知道」降级成「顺口提一句」。故按类型分档：
  //   error → assertive（打断当前朗读，立刻播报）；其余 → polite（不打断，择机播报）。
  // 判据下沉到这里（可单测），DOM 侧只负责把值写到容器属性上。
  function toastLiveMode(type) {
    return type === 'error' ? 'assertive' : 'polite';
  }

  // ========== 下拉框的固有宽度（opt-in base-select 之后的补偿）==========
  // `appearance: base-select` 让 select 由页面接管绘制，代价是它**不再按最长选项取宽**：
  // 实测同一个下拉换选中项会在 160 / 186 / 214 之间跳（原生恒定 231），表格上方的
  // 筛选条于是每选一次就左右抖一下。
  //
  // 试过且**全部无效**（都是「按内容定宽」该生效的写法，实测宽度照样跳）：
  //   field-sizing: content / min-width: max-content / width: max-content。
  // 唯一稳的办法：把固有宽度量一次、钉在 `--sel-w` 上。这里只放「要不要钉」的判据（可单测），
  // 量宽与写变量归 DOM 侧（见 index.html 的 freezeSelectWidths）。
  //
  // 不该钉的两种：
  //   - 选项全空：空下拉在等着被填充，钉住它就再也回不到内容宽；
  //   - 选项全空串：「全部时间 / 全部标签」这类占位项本身就是空的，按它钉宽等于按空串钉。
  // 多一个「全部××」与长选项并存的常见情形下必须钉——否则弹层与控件都会缩到占位项那么窄。
  function shouldPinSelectWidth(labels) {
    return (labels || []).some((t) => String(t == null ? '' : t).trim() !== '');
  }

  // ========== 拖拽排序的键盘替代 ==========
  // 拖拽把手原先只有 draggable——指针专属手势，键盘用户完全无法调整资产顺序。
  // 这里只做「数组里怎么挪」这一半（可单测）；键位判定与 DOM 副作用在 index.html。
  // 必须返回新数组而不改原数组：调用方拿返回值赋回 state，原地改动配合渲染函数
  // 的重绘时序容易静默不刷新。
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
  // 长按满时长自动弹确认框时，抬起的手指会紧跟一次 pointerup 与 click：
  // 遮罩的 click 会把确认框当场关掉（旧决策「弹窗只能松手时出现」就是为了躲这个，
  // 代价是用户必须「按满—松手」两步，不自然）。改为自动弹出 + 短守卫窗：
  // 弹出后一小段时间内的指针事件全部忽略，之后恢复。窗口必须是正的小量——
  // 太长会把用户真点的「确认」按钮也吞掉。
  const AUTO_OPEN_GUARD_MS = 400;
  function autoOpenGuard(elapsedSinceOpen, guardMs) {
    const g = guardMs === undefined ? AUTO_OPEN_GUARD_MS : guardMs;
    return elapsedSinceOpen >= g;
  }

  // ========== 弹窗焦点陷阱 ==========
  // 15 个弹窗都写了 role="dialog" aria-modal="true"——那是对读屏器的承诺：弹窗背后的
  // 内容不可达。但实测完全没接管焦点：打开后焦点还在触发按钮上、第一下 Tab 就走出弹窗、
  // 关闭后掉到 body。承诺是空的（写对了 ARIA 不等于做了行为）。
  //
  // 这里只做「判据」这一半（可单测），DOM 侧由 index.html 执行 focus()。
  // 返回 { wrap, index }：
  //   wrap=false → 交还浏览器默认行为（中间位置不必插手，插手反而会打断 IME/选区）；
  //   wrap=true  → 调用方把焦点移到 idx 出的那个元素上（绕回另一端）。
  // 为什么 index=-1（焦点不在弹窗内）要一律拉回来：刚打开时焦点还在触发按钮上，
  // 以及用户点了弹窗外/脚本聚焦到别处之后，都需要一把拉回弹窗内，否则
  // aria-modal 的承诺立刻是假的。
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
  // 分布图卡片上方的总数用它：旭日图只给各部分占比，用户看不到「当前筛选下到底多少」。
  // 为什么要显式传汇率表：消费侧金额恒为 CNY（无 currency 字段 → 按 1 充底），资产侧要按
  // 当前汇率折；同一个函数两页共用，不得各 reduce 一遍（那必然漂移）。
  // 脏数据（NaN / Infinity / 字符串金额）不污染总数：界面上的总数必须始终能显示。
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
    '月度消费': 'Monthly spending',
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
    '{p1} 笔': [ '{p1} entry', '{p1} entries' ],
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
    '盈余': 'Surplus',
    '缺口': 'Shortfall',
    '不足 1 个月': 'Less than a month',
    '{n} 个月': [ '{n} month', '{n} months' ],
    '{y} 年': [ '{y} year', '{y} years' ],
    '{y} 年 {m} 个月': '{y} yr {m} mo',
    '已超预算 {p1} · 本月额度已用完': 'Over budget by {p1} · nothing left this month',
    '预算剩 {p1} · 余 {p2} 天 · 日均 {p3}': '{p1} left · {p2} days to go · {p3}/day',
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
  };

  // 页面不直接调用、但被单测逐条断言的内部件（保留在域里：单测就是它们的使用者，
  // 删掉导出等于删掉那些断言的接缝）：date.addMonths / date.daysBetweenStr /
  // text.escRegExp / color.hexToHsl / color.hslToHex / color.CHART_INK / color.shadeAt /
  // chartData.nodeValue / chartData.childCount / expense.parseTagFilter /
  // expense.hasTagFilterOption / expense.applyExpenseFilters / income.getSafetyFactor /
  // backup.BACKUP_STALE_DAYS / backup.hasAnyBackupWorthyData / ui.AUTO_OPEN_GUARD_MS /
  // ui.TIP_GAP / ui.TIP_EDGE
  // 按域分组：接口按「这个函数管哪件事」划分，不再平铺成一袋名字。
  // 页面与单测都经域名访问（如 text.esc），新增函数先想清楚属于哪个域。
  return {
    i18n: {
      t,
      normalizeLang,
      langTag,
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
    },
    expense: {
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
    },
    migrate: {
      migrateState,
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
