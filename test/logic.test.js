/*
 * test/logic.test.js — 财富管理 核心纯逻辑单测
 * 运行：node --test
 * 零依赖：仅用 Node 内置 node:test / node:assert。
 * 被测逻辑来自 logic.js（与 index.html 内联脚本共用同一份源码）。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// 在测试中通过 globalThis 注入 index.html 的全局可变状态（state / incomeMode），
// 与浏览器中 logic.js 读取全局 `let state` 的行为一致。
function freshState(overrides = {}) {
  return Object.assign({
    rates: { CNY: 1, HKD: 0.9, USD: 7.2, fetchedAt: null },
    snapshots: [],
    categories: [],
    assets: [],
    expenses: [],
    expenseCategories: [],
    expenseExpectation: 0,
    netWorthTarget: 0,
    incomeSafetyFactor: 100,
  }, overrides);
}

beforeEach(() => {
  globalThis.state = freshState();
  globalThis.incomeMode = 'max';
});

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ========== 货币换算 ==========
describe('货币换算 toCNY / formatCNY', () => {
  test('toCNY 按汇率相乘', () => {
    assert.strictEqual(L.toCNY(100, 'CNY'), 100);
    assert.strictEqual(L.toCNY(100, 'HKD'), 90);
    assert.strictEqual(L.toCNY(100, 'USD'), 720);
  });
  test('toCNY 未知货币按 1 兜底', () => {
    assert.strictEqual(L.toCNY(100, 'XYZ'), 100);
  });
  test('formatCNY 输出 ¥ + 千分位 + 两位小数', () => {
    assert.strictEqual(L.formatCNY(100), '¥100.00');
    assert.strictEqual(L.formatCNY(1234.5), '¥1,234.50');
  });
});

// ========== 月份 / 日期 ==========
describe('月份与日期', () => {
  test('addMonths 跨年', () => {
    assert.strictEqual(L.addMonths('2024-12', 1), '2025-01');
    assert.strictEqual(L.addMonths('2024-01', 12), '2025-01');
  });
  test('addMonths 正负偏移与零', () => {
    assert.strictEqual(L.addMonths('2024-03', -1), '2024-02');
    assert.strictEqual(L.addMonths('2024-02', 0), '2024-02');
  });
  test('monthLabel 中文年月', () => {
    assert.strictEqual(L.monthLabel('2024-01'), '2024年1月');
    assert.strictEqual(L.monthLabel('2024-12'), '2024年12月');
    assert.strictEqual(L.monthLabel(''), '');
  });
  test('getLocalMonthStr / getLocalDateStr / getCurrentMonth 格式', () => {
    assert.match(L.getLocalDateStr(), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(L.getLocalMonthStr(), /^\d{4}-\d{2}$/);
    assert.strictEqual(L.getCurrentMonth(), L.getLocalMonthStr());
    assert.strictEqual(L.getLocalMonthStr().slice(0, 7), L.getLocalDateStr().slice(0, 7));
  });
});

// ========== 快照查询 ==========
describe('快照查询', () => {
  beforeEach(() => {
    globalThis.state = freshState({
      snapshots: [
        { month: '2024-01', totalCNY: 100 },
        { month: '2024-02', totalCNY: 200 },
        { month: '2024-03', totalCNY: 300 },
      ],
    });
  });
  test('findMonthSnapshot 按月份精确查找', () => {
    assert.strictEqual(L.findMonthSnapshot('2024-02').month, '2024-02');
    assert.strictEqual(L.findMonthSnapshot('2024-05'), undefined);
  });
  test('getPrevSnapshot 取上一月', () => {
    assert.strictEqual(L.getPrevSnapshot('2024-03').month, '2024-02');
    assert.strictEqual(L.getPrevSnapshot('2024-02').month, '2024-01');
    assert.strictEqual(L.getPrevSnapshot('2024-01'), null);
  });
});

describe('消费月度聚合 / 环比', () => {
  const expenses = [
    { date: '2024-01-15', amount: 100 },
    { date: '2024-01-20', amount: 50 },
    { date: '2024-03-05', amount: 300 }, // 2 月无记录（空月份）
    { date: '2024-03-10', amount: 100 },
    { date: '2024-04-01', amount: 250 },
  ];

  test('monthlyExpenseTotals 按月聚合并升序', () => {
    assert.deepStrictEqual(L.monthlyExpenseTotals(expenses), [
      { month: '2024-01', total: 150, count: 2 },
      { month: '2024-03', total: 400, count: 2 },
      { month: '2024-04', total: 250, count: 1 },
    ]);
  });

  test('monthlyExpenseTotals 空输入返回 []', () => {
    assert.deepStrictEqual(L.monthlyExpenseTotals([]), []);
    assert.deepStrictEqual(L.monthlyExpenseTotals(null), []);
  });

  test('prevExpenseMonthOf 跳过空月份', () => {
    const months = L.monthlyExpenseTotals(expenses);
    // 2024-03 之前最近的是 2024-01（跳过无记录的 2024-02）
    assert.strictEqual(L.prevExpenseMonthOf('2024-03', months), '2024-01');
    assert.strictEqual(L.prevExpenseMonthOf('2024-04', months), '2024-03');
    assert.strictEqual(L.prevExpenseMonthOf('2024-01', months), null);
  });

  test('expenseMoM 环比涨跌与百分比', () => {
    const a = L.expenseMoM(400, 150);
    assert.strictEqual(a.diff, 250);
    assert.ok(approx(a.pct, 250 / 150 * 100));
    assert.strictEqual(a.up, true);

    const b = L.expenseMoM(250, 400);
    assert.strictEqual(b.diff, -150);
    assert.strictEqual(b.pct, -37.5);
    assert.strictEqual(b.up, false);

    // 持平：up 为 true，pct 为 0
    assert.deepStrictEqual(L.expenseMoM(200, 200), { diff: 0, pct: 0, up: true });
    // 上月为 0：pct 归 0 避免 Infinity
    assert.deepStrictEqual(L.expenseMoM(100, 0), { diff: 100, pct: 0, up: true });
  });
});

describe('expenseMonthTagTotals 按标签聚合', () => {
  const expenses = [
    { date: '2024-03-05', amount: 100, tags: { c1: '餐饮' } },
    { date: '2024-03-10', amount: 50, tags: { c1: '交通' } },
    { date: '2024-03-12', amount: 200, tags: { c1: '餐饮' } },
    { date: '2024-04-01', amount: 80, tags: { c1: '餐饮' } },
    { date: '2024-04-02', amount: 30, tags: { c2: '微信' } }, // 不同维度
    { date: '2024-05-01', amount: 10, tags: { c1: '餐饮' } }, // 不同月
  ];
  test('按维度+标签聚合指定月', () => {
    assert.deepStrictEqual(L.expenseMonthTagTotals('2024-03', 'c1', expenses), { '餐饮': 300, '交通': 50 });
  });
  test('忽略其他月/其他维度', () => {
    assert.deepStrictEqual(L.expenseMonthTagTotals('2024-04', 'c1', expenses), { '餐饮': 80 });
    assert.deepStrictEqual(L.expenseMonthTagTotals('2024-03', 'c2', expenses), {});
  });
  test('无数据返回 {}', () => {
    assert.deepStrictEqual(L.expenseMonthTagTotals('2099-01', 'c1', expenses), {});
    assert.deepStrictEqual(L.expenseMonthTagTotals('2024-03', 'cX', expenses), {});
  });
});

// ========== 收益测算 ==========
describe('收益测算', () => {
  const asset = () => ({
    amount: 1000, currency: 'CNY',
    expectedRateMin: 5, expectedRateMax: 10, cashRatio: 100,
  });

  test('getAssetRate 取 min/max', () => {
    assert.strictEqual(L.getAssetRate(asset(), 'min'), 5);
    assert.strictEqual(L.getAssetRate(asset(), 'max'), 10);
  });
  test('getAssetRate 默认跟随 incomeMode', () => {
    globalThis.incomeMode = 'min';
    assert.strictEqual(L.getAssetRate(asset()), 5);
    globalThis.incomeMode = 'max';
    assert.strictEqual(L.getAssetRate(asset()), 10);
  });
  test('getCashRatio 比例与钳制', () => {
    assert.strictEqual(L.getCashRatio({ cashRatio: 100 }), 1);
    assert.strictEqual(L.getCashRatio({ cashRatio: 20 }), 0.2);
    assert.strictEqual(L.getCashRatio({ cashRatio: 150 }), 1);
    assert.strictEqual(L.getCashRatio({ cashRatio: -5 }), 0);
    assert.strictEqual(L.getCashRatio({}), 1); // 缺失默认 100%
  });
  test('getSafetyFactor 百分比折算与钳制', () => {
    globalThis.state = freshState({ incomeSafetyFactor: 100 });
    assert.strictEqual(L.getSafetyFactor(), 1);
    globalThis.state = freshState({ incomeSafetyFactor: 50 });
    assert.strictEqual(L.getSafetyFactor(), 0.5);
    globalThis.state = freshState({ incomeSafetyFactor: 200 });
    assert.strictEqual(L.getSafetyFactor(), 1);
    globalThis.state = freshState({ incomeSafetyFactor: 0 });
    assert.strictEqual(L.getSafetyFactor(), 1);
  });
  test('calcAssetIncome max 口径', () => {
    const r = L.calcAssetIncome(asset(), 'max');
    assert.ok(approx(r.cny, 1000));
    assert.ok(approx(r.annual, 100));
    assert.ok(approx(r.monthly, 100 / 12));
    assert.ok(approx(r.daily, 100 / 365));
    assert.ok(approx(r.cashAnnual, 100));
    assert.ok(approx(r.cashMonthly, 100 / 12));
  });
  test('calcAssetIncome min 口径与现金拆分', () => {
    const r = L.calcAssetIncome({ amount: 1000, currency: 'CNY', expectedRateMin: 5, expectedRateMax: 10, cashRatio: 20 }, 'min');
    assert.ok(approx(r.annual, 50));
    assert.ok(approx(r.cashAnnual, 10)); // 50 * 0.2
  });
  test('calcAssetIncome 含汇率换算与安全边际', () => {
    globalThis.state = freshState({ incomeSafetyFactor: 50, rates: { CNY: 1, HKD: 0.9, USD: 7.2, fetchedAt: null } });
    const usd = { amount: 100, currency: 'USD', expectedRateMin: 10, expectedRateMax: 10, cashRatio: 100 };
    const r = L.calcAssetIncome(usd, 'max');
    assert.ok(approx(r.cny, 720));
    assert.ok(approx(r.annual, 36)); // 720 * 10% * 0.5
    assert.ok(approx(r.cashAnnual, 36));
  });
});

// ========== 数据迁移 / 兜底 ==========
describe('migrateState 迁移与兜底', () => {
  test('旧快照 {id,date} 迁移为月度格式', () => {
    globalThis.state = freshState({
      snapshots: [{ id: 's1', date: '2024-01-15', note: 'n', totalCNY: 50, currencyRates: null, assets: [{ amount: 50, currency: 'CNY' }], updatedAt: null }],
    });
    L.migrateState();
    assert.strictEqual(state.snapshots.length, 1);
    assert.strictEqual(state.snapshots[0].month, '2024-01');
    assert.strictEqual(state.snapshots[0].updatedAt, '2024-01-15');
    assert.strictEqual(state.snapshots[0].note, 'n');
  });
  test('同月旧快照取最新一条', () => {
    globalThis.state = freshState({
      snapshots: [
        { id: 'a', date: '2024-01-10', assets: [] },
        { id: 'b', date: '2024-01-20', assets: [] },
      ],
    });
    L.migrateState();
    assert.strictEqual(state.snapshots.length, 1);
    assert.strictEqual(state.snapshots[0].updatedAt, '2024-01-20');
  });
  test('缺失 totalCNY 按当时汇率重算', () => {
    globalThis.state = freshState({
      snapshots: [{ month: '2024-02', totalCNY: null, currencyRates: { CNY: 1, USD: 7 }, assets: [{ amount: 100, currency: 'CNY' }, { amount: 50, currency: 'USD' }] }],
    });
    L.migrateState();
    assert.strictEqual(state.snapshots[0].totalCNY, 100 * 1 + 50 * 7);
  });
  test('自动创建 currency 内置分类（不重复）', () => {
    globalThis.state = freshState({ categories: [] });
    L.migrateState();
    assert.strictEqual(state.categories[0].id, 'currency');
    const before = state.categories.length;
    L.migrateState();
    assert.strictEqual(state.categories.length, before);
  });
  test('expectedRate -> Min/Max 并删除旧字段, 字符串 amount 转数字', () => {
    globalThis.state = freshState({ assets: [{ name: 'x', amount: '200', currency: 'CNY', expectedRate: 8 }] });
    L.migrateState();
    const a = state.assets[0];
    assert.strictEqual(a.expectedRateMin, 8);
    assert.strictEqual(a.expectedRateMax, 8);
    assert.strictEqual(a.expectedRate, undefined);
    assert.strictEqual(a.amount, 200);
    assert.strictEqual(typeof a.amount, 'number');
  });
  test('cashRatio 缺失默认 100, 越界钳制 0~100', () => {
    globalThis.state = freshState({ assets: [
      { amount: 1, currency: 'CNY', cashRatio: null },
      { amount: 1, currency: 'CNY', cashRatio: 150 },
      { amount: 1, currency: 'CNY', cashRatio: -5 },
    ] });
    L.migrateState();
    assert.strictEqual(state.assets[0].cashRatio, 100);
    assert.strictEqual(state.assets[1].cashRatio, 100);
    assert.strictEqual(state.assets[2].cashRatio, 0);
  });
  test('rates 缺失/损坏时重置与补全', () => {
    globalThis.state = freshState({ rates: undefined });
    L.migrateState();
    assert.deepStrictEqual(state.rates, { CNY: 1, HKD: 1, USD: 1, fetchedAt: null });
    globalThis.state = freshState({ rates: { CNY: 1 } });
    L.migrateState();
    assert.strictEqual(state.rates.HKD, 1);
    assert.strictEqual(state.rates.USD, 1);
  });
  test('incomeSafetyFactor 缺失/越界钳制 1~100', () => {
    globalThis.state = freshState({ incomeSafetyFactor: null });
    L.migrateState();
    assert.strictEqual(state.incomeSafetyFactor, 100);
    globalThis.state = freshState({ incomeSafetyFactor: 250 });
    L.migrateState();
    assert.strictEqual(state.incomeSafetyFactor, 100);
    globalThis.state = freshState({ incomeSafetyFactor: 0 });
    L.migrateState();
    // 注意：实现用 Number(x) || 100，0 被当作「未设置」→ 默认 100（而非下限 1）。
    // 这是当前真实行为，测试如实锁定；如需 0→1 的下限语义需改 migrateState。
    assert.strictEqual(state.incomeSafetyFactor, 100);
  });
  test('移除旧 expense-type 分类并清理孤立标签引用', () => {
    globalThis.state = freshState({
      expenseCategories: [
        { id: 'expense-type', builtin: true, tags: ['a'] },
        { id: 'cat1', tags: ['t1'] },
      ],
      expenses: [{ amount: 10, tags: { cat1: 't1', 'expense-type': 'a', orphan: 'x' } }],
    });
    L.migrateState();
    assert.deepStrictEqual(state.expenseCategories.map(c => c.id), ['cat1']);
    assert.deepStrictEqual(Object.keys(state.expenses[0].tags), ['cat1']);
  });
  test('snapshots 非数组时兜底为 []', () => {
    globalThis.state = freshState({ snapshots: 'garbage' });
    L.migrateState();
    assert.deepStrictEqual(state.snapshots, []);
  });
  test('expenseExpectation/netWorthTarget 字符串归一为数字，非法值归 0', () => {
    globalThis.state = freshState({ expenseExpectation: '1000', netWorthTarget: '5000' });
    L.migrateState();
    assert.strictEqual(state.expenseExpectation, 1000);
    assert.strictEqual(state.netWorthTarget, 5000);
    globalThis.state = freshState({ expenseExpectation: 'abc', netWorthTarget: NaN });
    L.migrateState();
    assert.strictEqual(state.expenseExpectation, 0);
    assert.strictEqual(state.netWorthTarget, 0);
  });
  test('消费记录 date/tags 归一：缺 date 补空串、缺 tags 补空对象（防 DOM 侧 slice/下标崩溃）', () => {
    globalThis.state = freshState({
      expenseCategories: [{ id: 'cat1', name: 'c', builtin: false, tags: ['t'] }],
      expenses: [
        { amount: '12', note: 'x' },
        { amount: 3, date: null, tags: null },
        { amount: 4, date: '2024-05-01', tags: { cat1: 't' } },
      ],
    });
    L.migrateState();
    for (const e of state.expenses) {
      assert.strictEqual(typeof e.date, 'string', 'date 应归一为字符串');
      assert.ok(e.tags && typeof e.tags === 'object', 'tags 应归一为对象');
    }
    assert.strictEqual(state.expenses[0].date, '');
    assert.deepStrictEqual(state.expenses[0].tags, {});
    assert.strictEqual(state.expenses[0].amount, 12);
    assert.strictEqual(state.expenses[2].date, '2024-05-01');
    assert.deepStrictEqual(state.expenses[2].tags, { cat1: 't' });
  });
  test('资产 tags 缺失归一为空对象，防 tags[catId] 崩溃', () => {
    globalThis.state = freshState({ assets: [
      { amount: 1, currency: 'CNY' },
      { amount: 2, currency: 'CNY', tags: null },
      { amount: 3, currency: 'CNY', tags: { currency: 'CNY' } },
    ] });
    L.migrateState();
    assert.deepStrictEqual(state.assets[0].tags, {});
    assert.deepStrictEqual(state.assets[1].tags, {});
    assert.deepStrictEqual(state.assets[2].tags, { currency: 'CNY' });
  });
});

// ========== 文本 / 金额工具 ==========
describe('文本与金额工具', () => {
  test('esc 转义 & < > " \'', () => {
    assert.strictEqual(L.esc('<a>&'), '&lt;a&gt;&amp;');
    assert.strictEqual(L.esc(`x'y"z`), 'x&#39;y&quot;z');
    assert.strictEqual(L.esc('plain'), 'plain');
    assert.strictEqual(L.esc(''), '');
    assert.strictEqual(L.esc(null), '');
  });
  test('escRegExp 转义正则元字符', () => {
    assert.strictEqual(L.escRegExp('a.b*c'), 'a\\.b\\*c');
    assert.strictEqual(L.escRegExp('hello'), 'hello');
  });
  test('highlightMatch 不区分大小写保留原大小写 + 命中高亮', () => {
    assert.strictEqual(L.highlightMatch('Hello World', 'world'), 'Hello <mark class="search-hit">World</mark>');
    assert.strictEqual(L.highlightMatch('a<b', '<'), 'a<mark class="search-hit">&lt;</mark>b');
    assert.strictEqual(L.highlightMatch('text', ''), 'text');
    assert.strictEqual(L.highlightMatch('NoMatch', 'xyz'), 'NoMatch');
  });
  test('moneyStr 千分位与空值', () => {
    assert.strictEqual(L.moneyStr(1234567), '1,234,567');
    assert.strictEqual(L.moneyStr(1234.5), '1,234.5');
    assert.strictEqual(L.moneyStr('1,234'), '1,234');
    assert.strictEqual(L.moneyStr(1000000.99), '1,000,000.99');
    assert.strictEqual(L.moneyStr(''), '');
    assert.strictEqual(L.moneyStr(null), '');
    assert.strictEqual(L.moneyStr('abc'), '');
  });
  test('jsAttr JS + HTML 属性转义', () => {
    assert.strictEqual(L.jsAttr('a&b'), 'a&amp;b');
    assert.strictEqual(L.jsAttr("a'b"), "a\\'b");
    assert.strictEqual(L.jsAttr('a"b'), 'a&quot;b');
    assert.strictEqual(L.jsAttr('a\\b'), 'a\\\\b');
  });
  test('truncateLabel 中英文截断与省略号', () => {
    assert.strictEqual(L.truncateLabel('', 12, 100), '');
    assert.strictEqual(L.truncateLabel('短', 12, 100), '短');
    assert.strictEqual(L.truncateLabel('abcdefghijklmnop', 12, 60), 'abcdef…');
    assert.strictEqual(L.truncateLabel('中文测试中文测试', 12, 50), '中文测…');
  });
});

// ========== 颜色数学 ==========
describe('颜色数学', () => {
  test('hexToHsl 基础色', () => {
    assert.deepStrictEqual(L.hexToHsl('#ffffff'), { h: 0, s: 0, l: 100 });
    assert.deepStrictEqual(L.hexToHsl('#000000'), { h: 0, s: 0, l: 0 });
    assert.deepStrictEqual(L.hexToHsl('#ff0000'), { h: 0, s: 100, l: 50 });
  });
  test('hslToHex 与 hexToHsl 互逆', () => {
    assert.strictEqual(L.hslToHex(0, 100, 50), '#ff0000');
    assert.strictEqual(L.hslToHex(0, 0, 100), '#ffffff');
    assert.strictEqual(L.hslToHex(0, 0, 0), '#000000');
  });
  test('pillColors 亮/暗分支结构', () => {
    const base = { bg: '#ff0000', fg: '#111111', border: '#cccccc' };
    const light = L.pillColors(base, 0, false);
    const dark = L.pillColors(base, 0, true);
    for (const c of [light, dark]) {
      assert.ok(c.bg.startsWith('#'));
      assert.ok(c.fg.startsWith('#'));
      assert.ok(c.border.startsWith('#'));
    }
    // 暗色背景亮度应低于亮色
    assert.ok(L.hexToHsl(light.bg).l > L.hexToHsl(dark.bg).l);
    // 标签序数 t 影响插值与基色不同
    assert.notStrictEqual(L.pillColors(base, 0, false).bg, L.pillColors(base, 1, false).bg);
  });
  test('basePill 亮色返回基色副本, 暗色返回深底', () => {
    const base = { bg: '#ff0000', fg: '#111111', border: '#cccccc' };
    assert.deepStrictEqual(L.basePill(base, false), { ...base });
    assert.notStrictEqual(L.basePill(base, true).bg, base.bg);
  });
});

// ========== 分类 pill 可读性：对比度不达标就是「看不清」 ==========
// 曾出现的真实缺陷：亮色分支按色相公式重算底/字，t=1 时底色被压深到 70% 明度而字只有
// 38%，实测对比 2.4:1 —— 标签 pill 是资产/消费列表里信息密度最高的元素，用户第一眼
// 就看它。口径：pillColors 的每个插值点 + 基色本身，亮/暗两套都必须达 WCAG AA（4.5:1）。
describe('分类 pill 配色对比度（AA 4.5:1，亮/暗 × 每个插值点）', () => {
  // 测试专用：WCAG 相对亮度与对比度（不进 logic.js——生产代码没有这个需求）
  const lum = (hex) => {
    const s = hex.replace('#', '');
    const c = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  test('CATEGORY_COLORS 是十组 {bg,fg,border}（pill 与图表共用同一份数据源）', () => {
    assert.ok(Array.isArray(L.CATEGORY_COLORS), 'CATEGORY_COLORS 应从 logic.js 导出');
    assert.strictEqual(L.CATEGORY_COLORS.length, 10);
    for (const c of L.CATEGORY_COLORS) {
      assert.match(c.bg, /^#[0-9a-f]{6}$/i);
      assert.match(c.fg, /^#[0-9a-f]{6}$/i);
      assert.match(c.border, /^#[0-9a-f]{6}$/i);
    }
  });

  test('亮色：基色 + 每个插值点都达 AA', () => {
    const bad = [];
    for (const base of L.CATEGORY_COLORS) {
      const r0 = ratio(base.fg, base.bg);
      if (r0 < 4.5) bad.push(`基色 ${base.bg}→${base.fg} = ${r0.toFixed(2)}`);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const c = L.pillColors(base, t, false);
        const r = ratio(c.fg, c.bg);
        if (r < 4.5) bad.push(`亮色 t=${t} ${c.bg}→${c.fg} = ${r.toFixed(2)}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('暗色：基色 + 每个插值点都达 AA', () => {
    const bad = [];
    for (const base of L.CATEGORY_COLORS) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const c = L.pillColors(base, t, true);
        const r = ratio(c.fg, c.bg);
        if (r < 4.5) bad.push(`暗色 t=${t} ${c.bg}→${c.fg} = ${r.toFixed(2)}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('插值仍有区分度：t=0 与 t=1 底色不同（序数可辨）', () => {
    for (const base of L.CATEGORY_COLORS) {
      assert.notStrictEqual(L.pillColors(base, 0, false).bg, L.pillColors(base, 1, false).bg);
      assert.notStrictEqual(L.pillColors(base, 0, true).bg, L.pillColors(base, 1, true).bg);
    }
  });

  /*
   * 图表色板的文字对比度（旭日图/堆叠柱把标签印在色块上）。
   * 为什么需要：pill 那套有 assert，图表这套一直只靠「看着还行」——实测 10 个基色里
   * **7 个**的白字低于 4.5:1（最差 2.27，来自琥珀色），而标签色一度写死在
   * buildSunburstOption 里（`color: '#fff'`），改色板也不会有人发现。
   * 不变量：每个基色自带一个达标的字色（label），外环三阶也都有达标字色。
   */
  test('CATEGORY_PALETTE 每个条目都带达标字色（内环基色 / 外环三阶各自一个）', () => {
    // 内外环的字色**分开给**：内环是饱和深底（白字），外环是同色相浅底（墨字）。
    // 早先只有写死的白字，外环浅底上白字实测只有 2.0~3.7:1——这张表此前根本没人查。
    assert.ok(L.CHART_INK, '外环浅阶的字色（墨）应为具名常量，供三图共用');
    const bad = [];
    for (const [i, p] of L.CATEGORY_PALETTE.entries()) {
      assert.match(p.base, /^#[0-9a-f]{6}$/i, `#${i} 基色格式`);
      assert.match(p.label, /^#[0-9a-f]{6}$/i, `#${i} 内环字色必须显式给出（不得靠调用方写死白色）`);
      const rb = ratio(p.label, p.base);
      if (rb < 4.5) bad.push(`#${i} 内环 ${p.base}←${p.label} = ${rb.toFixed(2)}`);
      for (const s of p.shades) {
        const rs = ratio(L.CHART_INK, s);
        if (rs < 4.5) bad.push(`#${i} 外环 ${s}←${L.CHART_INK} = ${rs.toFixed(2)}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('外环三阶彼此可分辨（同分类下的兄弟条目靠它区分）', () => {
    for (const [i, p] of L.CATEGORY_PALETTE.entries()) {
      assert.strictEqual(p.shades.length, 3, `#${i} 外环阶数`);
      const ls = p.shades.map(s => L.hexToHsl(s).l);
      for (const [a, b] of [[0, 1], [1, 2]]) {
        assert.ok(ls[b] - ls[a] >= 5,
          `#${i} 外环第 ${a}/${b} 阶明度只差 ${(ls[b] - ls[a]).toFixed(1)}%，挤在一起看不出是两个条目`);
      }
    }
  });
});

// ========== 图表数据构造（旭日图 / 占比）==========
describe('图表数据构造 buildSunburstData / pctStr / percentSeriesData', () => {
  const cat = { id: 'c1', name: '分类', tags: ['T1', 'T2', 'T3'] };

  test('buildSunburstData 按标签套用 CATEGORY_PALETTE 配色, 跳过空分组', () => {
    const groups = {
      T1: [{ name: 'A', value: 100 }, { name: 'B', value: 50 }],
      T2: [],
      T3: [{ name: 'C', value: 7 }],
    };
    const data = L.buildSunburstData(cat, groups, c => c.value);
    assert.strictEqual(data.length, 2); // T2 空分组被跳过
    assert.strictEqual(data[0].name, 'T1');
    assert.strictEqual(data[0].itemStyle.color, L.CATEGORY_PALETTE[0].base);
    assert.strictEqual(data[1].name, 'T3');
    assert.strictEqual(data[1].itemStyle.color, L.CATEGORY_PALETTE[1].base); // 过滤后 ti=1
    assert.strictEqual(data[0].children.length, 2);
    assert.strictEqual(data[0].children[0].value, 100);
    assert.strictEqual(data[0].children[0].itemStyle.color, L.CATEGORY_PALETTE[0].shades[0]);
    assert.strictEqual(data[0].children[1].itemStyle.color, L.CATEGORY_PALETTE[0].shades[1]);
  });

  test('buildSunburstData childValue 决定数值, extra 透传, 四舍五入两位', () => {
    const groups = { T1: [{ name: 'A', k: 3, extra: { _assetId: 'x' } }] };
    const data = L.buildSunburstData(cat, groups, c => c.k * 1.23456); // 3.70368 → 3.7
    assert.strictEqual(data[0].children[0].value, 3.7);
    assert.strictEqual(data[0].children[0].name, 'A');
    assert.strictEqual(data[0].children[0]._assetId, 'x');
  });

  test('buildSunburstData 把字色写在节点上（实测 levels 回调不生效）', () => {
    // 回归：字色一度写成 levels[].label.color 的函数，ECharts 5 在真实图上不逐节点求值，
    // 内环退回默认黑字——HKD 深绿底上的黑字实测只有 2.15:1（像素级量出来的）。
    // 写在节点上确定生效，且能被这条断言直接钉住。
    const data = L.buildSunburstData(
      { id: 'c', name: '分类', tags: ['T1'] },
      { T1: [{ name: 'A', value: 1 }, { name: 'B', value: 1 }] },
      x => x.value,
    );
    const pal = L.CATEGORY_PALETTE[0];
    assert.strictEqual(data[0].label.color, pal.label, '内环用色板自带的 label');
    assert.strictEqual(data[0].children[0].label.color, L.CHART_INK, '外环浅阶一律墨字');
    assert.strictEqual(data[0].children[1].label.color, L.CHART_INK);
    // 字色必须与底色同源（同一份色板），否则改了色板忘了改字就是隐形回归
    assert.strictEqual(data[0].itemStyle.color, pal.base);
    assert.strictEqual(data[0].children[0].itemStyle.color, L.shadeAt(pal, 0));
    assert.strictEqual(data[0].children[1].itemStyle.color, L.shadeAt(pal, 1));
  });

  test('buildSunburstData 空 groups 返回空数组', () => {
    assert.deepStrictEqual(L.buildSunburstData(cat, {}, c => c.value), []);
  });

  test('CATEGORY_PALETTE 每项含 base、label 与 3 档 shades', () => {
    assert.strictEqual(L.CATEGORY_PALETTE.length, 10);
    L.CATEGORY_PALETTE.forEach(p => {
      assert.match(p.base, /^#[0-9a-fA-F]{6}$/);
      assert.match(p.label, /^#[0-9a-fA-F]{6}$/, '内环字色随色板给，不得由调用方写死');
      assert.strictEqual(p.shades.length, 3);
    });
  });

  test('shadeAt 按序轮转外环色阶（三阶用完回第一阶）', () => {
    const pal = { base: '#000000', label: '#FFFFFF', shades: ['a', 'b', 'c'] };
    assert.strictEqual(L.shadeAt(pal, 0), 'a');
    assert.strictEqual(L.shadeAt(pal, 2), 'c');
    assert.strictEqual(L.shadeAt(pal, 3), 'a', '第四个条目回到第一阶（条目多于色阶是常态）');
    assert.strictEqual(L.shadeAt(pal, 7), 'b');
  });

  /*
   * 旭日图右侧的构成清单：图的左右各有近 1/3 画布是空的（外径受高度限制，
   * 只能到 88%），那一片白拿着没用——不如把每个分类的金额与占比列出来，
   * 顺带把「谁占多少」从悬停才能看到变成一眼可读。
   * 占比分母与 tooltip 必须是同一个（同一张卡上两个「占比」各算各的口径就是 bug）。
   */
  test('sunburstLegendRows 按值降序列出分类与占比（分母同 tooltip）', () => {
    const data = [
      { name: '现金', value: 100 },
      { name: '股票', value: 300 },
      { name: '零头', value: 0 },
    ];
    const out = L.sunburstLegendRows(data, 400, null);
    assert.deepStrictEqual(out.map(x => x.name), ['股票', '现金', '零头']);
    assert.strictEqual(out[0].pct, '75.0');
    assert.strictEqual(out[1].pct, '25.0');
    assert.strictEqual(out[2].pct, '0.0');
    // idx 必须指向**原 data** 里的位置（清单按值降序排过，行号 ≠ dataIndex）：
    // 悬停联动靠它定位扇区，用行号就会「悬停 A、高亮 B」
    assert.deepStrictEqual(out.map(x => x.idx), [1, 0, 2], 'idx 跟着条目走，不随排序重编');
  });

  test('sunburstLegendRows 边界：空数组 / 缺 value / 分母为零 / 缺失入参', () => {
    assert.deepStrictEqual(L.sunburstLegendRows([], 100, null), []);
    assert.deepStrictEqual(L.sunburstLegendRows(null, 100, null), []);
    assert.deepStrictEqual(L.sunburstLegendRows(undefined, undefined, null), []);
    const out = L.sunburstLegendRows([{ name: 'A', value: '30' }, { name: 'B' }], 0);
    // 分母为零时占比归 '0.0'（不出现 Infinity/NaN），值非数字归 0（不污染排序）
    assert.deepStrictEqual(out.map(x => [x.name, x.value, x.pct]), [['A', 30, '0.0'], ['B', 0, '0.0']]);
  });

  test('sunburstLegendRows 对「只有 children、没有 value」的分类节点按子项求和', () => {
    // 回归：buildSunburstData 只给**叶子**写 value，内环分类节点没有 value——
    // ECharts 是按 children 求和定扇区大小的，清单若直接读 n.value 会全部得到 0，
    // 实测表现是清单里满屏「¥0.00 / 0.0%」而图是正常的（真实浏览器里才看得见）。
    const data = L.buildSunburstData(
      { id: 'c', name: '分类', tags: ['现金', '股票'] },
      { '现金': [{ name: '招行', value: 100 }, { name: '汇丰', value: 50 }], '股票': [{ name: '沪深300', value: 250 }] },
      x => x.value,
    );
    const out = L.sunburstLegendRows(data, 400, null);
    assert.deepStrictEqual(out.map(x => [x.name, x.value, x.pct]), [
      ['股票', 250, '62.5'],
      ['现金', 150, '37.5'],
    ]);
  });

  test('nodeValue 边界：叶子取自身值 / 无 value 无 children 归零 / 字符串值不予采纳', () => {
    assert.strictEqual(L.nodeValue({ value: 12 }), 12);
    assert.strictEqual(L.nodeValue({ value: 0 }), 0, 'value 为 0 是合法值，不该被当成缺失');
    assert.strictEqual(L.nodeValue({ children: [{ value: 1 }, { children: [{ value: 2 }] }] }), 3, '递归求和');
    assert.strictEqual(L.nodeValue({ name: '空' }), 0);
    assert.strictEqual(L.nodeValue(null), 0);
    assert.strictEqual(L.nodeValue(undefined), 0);
    assert.strictEqual(L.nodeValue({ value: '30' }), 30, '数字字符串照 ECharts 的惯例采纳（两处口径一致）');
    assert.strictEqual(L.nodeValue({ value: 'abc' }), 0, '非数字字符串归零，不污染求和');
  });

  /*
   * 点内环分类 → 右侧清单换成「该分类下的条目」。
   * ------------------------------------------------------------------------
   * 需求原话：「选中其中一个层级的时候，他右边的标签可以联动成选中的当前分类下的一些标签」。
   * 落地要解决三件事，全部下沉到这个纯函数：
   *   ① 显式选中优先于默认（默认 = 全部，即顶层分类列表）；
   *   ② 选中的分类必须真实存在（点完又被删掉/换维度时不能留下悬空状态）；
   *   ③ 条目级占比的**分母是该分类合计**，不是全局合计（否则一条明细的百分比加起来不是 100%）。
   */
  test('sunburstLegendRows 未选中时列顶层分类，占比分母为全局合计', () => {
    const data = [
      { name: '现金', children: [{ name: '招行', value: 100 }, { name: '汇丰', value: 50 }] },
      { name: '股票', children: [{ name: '沪深300', value: 250 }] },
    ];
    const out = L.sunburstLegendRows(data, 400, null);
    assert.deepStrictEqual(out.map(x => [x.name, x.value, x.pct]), [
      ['股票', 250, '62.5'],
      ['现金', 150, '37.5'],
    ]);
    assert.strictEqual(out[0].idx, 1, 'idx 仍指原 data 下标（供高亮联动）');
    assert.strictEqual(out[0].path, null, '未选中时无父节点路径');
  });

  test('sunburstLegendRows 选中分类后列其条目，占比分母换成该分类合计', () => {
    const data = [
      { name: '现金', children: [{ name: '招行', value: 100 }, { name: '汇丰', value: 50 }] },
      { name: '股票', children: [{ name: '沪深300', value: 250 }] },
    ];
    // 选中「现金」→ 两条明细，分母 = 150（不是 400）
    const out = L.sunburstLegendRows(data, 400, '现金');
    assert.deepStrictEqual(out.map(x => [x.name, x.value, x.pct]), [
      ['招行', 100, '66.7'],
      ['汇丰', 50, '33.3'],
    ]);
    // 明细要能反查到自己的父分类与在原 data 里的位置（高亮要定位到这条明细的扇区）
    assert.deepStrictEqual(out.map(x => x.path), [['现金', 0], ['现金', 1]]);
    assert.deepStrictEqual(out.map(x => x.idx), [0, 1], '分类内序号（同分类下高亮用）');
  });

  test('sunburstLegendRows 选中不存在的分类时回落为未选中（不留悬空状态）', () => {
    const data = [{ name: '现金', children: [{ name: '招行', value: 100 }] }];
    const missing = L.sunburstLegendRows(data, 100, '已被删掉的分类');
    assert.deepStrictEqual(missing.map(x => x.name), ['现金'], '回落为顶层列表');
    assert.strictEqual(missing[0].path, null);
  });

  test('sunburstLegendRows 选中无子项的分类时返回空列表（不抛错）', () => {
    const data = [{ name: '空分类', children: [] }];
    assert.deepStrictEqual(L.sunburstLegendRows(data, 0, '空分类'), []);
  });

  test('sunburstLegendRows 边界：缺失入参 / 未知形态的 children / 分母为零', () => {
    assert.deepStrictEqual(L.sunburstLegendRows(null, 100, null), []);
    assert.deepStrictEqual(L.sunburstLegendRows(undefined, undefined, undefined), []);
    // children 不是数组（脏数据）时按「无子项」处理，而不是崩掉整个清单
    const dirty = [{ name: 'A', children: 'oops' }, { name: 'B', children: [{ name: 'b', value: 5 }] }];
    const top = L.sunburstLegendRows(dirty, 5, null);
    assert.deepStrictEqual(top.map(x => x.name), ['B', 'A'], '脏节点按 0 计值，仍参与排序');
    assert.deepStrictEqual(L.sunburstLegendRows(dirty, 5, 'A'), [], '选中脏节点 → 空列表');
    // 分母为零：占比一律 '0.0'，不出现 NaN/Infinity
    const zero = L.sunburstLegendRows([{ name: 'X', children: [{ name: 'x', value: 0 }] }], 0, 'X');
    assert.deepStrictEqual(zero.map(x => [x.name, x.pct]), [['x', '0.0']]);
  });

  test('sunburstLegendRows 不改写入参', () => {
    const data = [{ name: 'A', children: [{ name: 'a', value: 2 }, { name: 'b', value: 1 }] }];
    const snap = JSON.stringify(data);
    L.sunburstLegendRows(data, 3, 'A');
    L.sunburstLegendRows(data, 3, null);
    assert.strictEqual(JSON.stringify(data), snap, '排序只在副本上做');
  });

  /*
   * 清单条目 → 图上扇区的路径。
   * 实测（真实 ECharts 5）：旭日图的 dataIndex 是**扁平化的树下标**，虚拟根占 0，
   * 于是「data 数组里的分类 N」对应的 path 是 [N]，「分类 N 下的第 k 个条目」是 [N, k]。
   * 曾经直接传顶层数组下标，导致悬停清单高亮到隔壁扇区（差一个）。
   */
  test('sunburstNodePath 给出「顶层下标 → 扁平树下标」的换算', () => {
    const data = [
      { name: '现金', children: [{ name: '招行' }, { name: '汇丰' }] },
      { name: '股票', children: [{ name: '沪深300' }] },
    ];
    // 扁平序：root(0), 现金(1), 招行(2), 汇丰(3), 股票(4), 沪深300(5)
    assert.deepStrictEqual(L.sunburstNodePath(data, 0, null), 1, '第 0 个分类 → 扁平下标 1');
    assert.deepStrictEqual(L.sunburstNodePath(data, 1, null), 4, '第 1 个分类 → 扁平下标 4');
    assert.deepStrictEqual(L.sunburstNodePath(data, 0, 1), 3, '现金下第 1 个条目 → 扁平下标 3');
    assert.deepStrictEqual(L.sunburstNodePath(data, 1, 0), 5, '股票下第 0 个条目 → 扁平下标 5');
  });

  test('sunburstNodePath 边界：越界/缺失入参返回 null（调用方跳过高亮而不是乱亮）', () => {
    const data = [{ name: 'A', children: [{ name: 'a' }] }];
    assert.strictEqual(L.sunburstNodePath(null, 0, null), null);
    assert.strictEqual(L.sunburstNodePath(data, 5, null), null, '分类越界');
    assert.strictEqual(L.sunburstNodePath(data, 0, 7), null, '条目越界');
    assert.strictEqual(L.sunburstNodePath(data, -1, null), null);
    // 该分类没有 children 时，条目下标任何值都无意义
    assert.strictEqual(L.sunburstNodePath([{ name: 'A' }], 0, 0), null);
  });

  test('sunburstLegendRows 不改写入参（图表 setOption 复用同一份 data 数组）', () => {
    const data = [{ name: 'A', value: 1 }, { name: 'B', value: 2 }];
    const snapshot = JSON.stringify(data);
    L.sunburstLegendRows(data, 3, null);
    assert.strictEqual(JSON.stringify(data), snapshot, '排序必须在副本上做');
  });

  /*
   * 旭日图的「视图」：喂给图的数据与分母，必须由清单的选中态派生。
   * ------------------------------------------------------------------------
   * 修的是一个真 bug：ECharts 自己还有一套 view root（nodeClick 会改它），
   * 与清单的 sunburstLegendSel 各自为政，于是「返回全部分类」只清了清单，
   * 图仍停在下钻层（用户原话：「返回到整个全景的时候，依然展示的是具体分类的值」）。
   * 让喂给图的数据就是选中分类本身，图上便没有第二套状态可漂。
   */
  test('sunburstDrillView 未选中时原样返回全量与给定分母', () => {
    const data = [{ name: '现金', children: [{ name: '招行', value: 100 }] }, { name: '股票', value: 250 }];
    const snap = JSON.stringify(data);
    const view = L.sunburstDrillView(data, 400, null);
    assert.strictEqual(view.data, data, '未下钻时直接复用入参（每帧重建数组没有意义）');
    assert.strictEqual(view.total, 400, '分母仍是调用方给的筛选合计');
    assert.strictEqual(JSON.stringify(data), snap, '不改写入参');
    // 空选中值（'' / undefined）与 null 同义
    assert.strictEqual(L.sunburstDrillView(data, 400, '').data, data);
    assert.strictEqual(L.sunburstDrillView(data, 400, undefined).total, 400);
  });

  test('sunburstDrillView 选中分类时只喂该分类，分母换成该分类合计', () => {
    const data = [
      { name: '现金', children: [{ name: '招行', value: 100 }, { name: '汇丰', value: 50 }] },
      { name: '股票', children: [{ name: '沪深300', value: 250 }] },
    ];
    const view = L.sunburstDrillView(data, 400, '现金');
    assert.deepStrictEqual(view.data.map(x => x.name), ['现金'], '下钻 = 图的数据只剩该分类');
    // 分类节点不带 value，分母必须按 children 求和（与扇区大小同源）
    assert.strictEqual(view.total, 150, '分母换成该分类合计，不是全局 400');
    assert.strictEqual(L.sunburstDrillView(data, 400, '股票').total, 250);
  });

  test('sunburstDrillView 边界：缺失入参 / 选中不存在的分类 / 分母非数字 / 空分类', () => {
    assert.deepStrictEqual(L.sunburstDrillView(null, 100, '现金'), { data: [], total: 100 });
    assert.deepStrictEqual(L.sunburstDrillView(undefined, undefined, null), { data: [], total: 0 });
    const data = [{ name: '现金', children: [{ name: '招行', value: 100 }] }];
    // 选中的分类不在当前数据里（被删/换维度）→ 回落为全量，与 sunburstLegendRows 同口径
    assert.strictEqual(L.sunburstDrillView(data, 100, '已被删掉的分类').data, data);
    assert.strictEqual(L.sunburstDrillView(data, 100, '已被删掉的分类').total, 100);
    // 分母非数字/NaN 归 0，不把 NaN 传给 tooltip（会渲染成「NaN%」）
    assert.strictEqual(L.sunburstDrillView(data, 'abc', null).total, 0);
    // 选中没有 children 的分类：数据只剩它，分母 0（占比由 pctStr 兜成 0.0）
    assert.deepStrictEqual(L.sunburstDrillView([{ name: '空' }], 100, '空').total, 0);
  });

  test('pctStr 占比字符串与分母为零兜底', () => {
    assert.strictEqual(L.pctStr(50, 200), '25.0');
    assert.strictEqual(L.pctStr(1, 3), '33.3');
    assert.strictEqual(L.pctStr(0, 0), '0.0');
    assert.strictEqual(L.pctStr(10, 0), '0.0');
  });

  test('percentSeriesData 保留 raw 并给出百分比数值, 分母为零兜底', () => {
    const out = L.percentSeriesData([50, 150], [200, 200]);
    assert.deepStrictEqual(out, [
      { value: 25, raw: 50 },
      { value: 75, raw: 150 },
    ]);
    const zero = L.percentSeriesData([10], [0]);
    assert.strictEqual(zero[0].value, 0);
    assert.strictEqual(zero[0].raw, 10);
  });

  test('pruneLegendSelected 只保留当前存在的系列名，不改入参', () => {
    const sel = { 股票: false, 债券: true, 现金: true, 旧分类标签: false };
    const out = L.pruneLegendSelected(sel, ['股票', '债券', '现金']);
    assert.deepStrictEqual(out, { 股票: false, 债券: true, 现金: true });
    // 不修改入参
    assert.strictEqual(sel['旧分类标签'], false);
    assert.deepStrictEqual(Object.keys(sel).sort(), ['债券', '旧分类标签', '现金', '股票'].sort());
  });

  test('pruneLegendSelected 兼容缺失/非法入参，保留 false 值', () => {
    assert.deepStrictEqual(L.pruneLegendSelected(null, ['a']), {});
    assert.deepStrictEqual(L.pruneLegendSelected({ a: false }, null), {});
    assert.deepStrictEqual(L.pruneLegendSelected(undefined, undefined), {});
    assert.deepStrictEqual(L.pruneLegendSelected({ a: false }, ['a']), { a: false });
  });
});

// ========== 补充边界（既有函数）==========
describe('补充边界', () => {
  test('getAssetRate 兼容旧版 expectedRate 字段, 新字段优先', () => {
    assert.strictEqual(L.getAssetRate({ expectedRate: 8 }, 'min'), 8);
    assert.strictEqual(L.getAssetRate({ expectedRateMin: 5, expectedRate: 99 }, 'min'), 5);
    assert.strictEqual(L.getAssetRate({}, 'max'), 0);
  });
  test('toCNY 汇率字段缺失按 1 兜底', () => {
    globalThis.state = freshState({ rates: { CNY: 1, HKD: 0.9, USD: 7.2 } }); // 无 EUR
    assert.strictEqual(L.toCNY(100, 'EUR'), 100);
  });
  test('amountAtRates 显式汇率表折算：缺失兑底/非法金额归零，与图表色块同口径', () => {
    assert.strictEqual(L.amountAtRates(100, 'HKD', { HKD: 0.9 }), 90);
    assert.strictEqual(L.amountAtRates(100, 'USD', { CNY: 1 }), 100); // 币种不在表中按 1
    assert.strictEqual(L.amountAtRates(100, 'HKD', null), 100);       // 汇率表缺失按 1
    assert.strictEqual(L.amountAtRates(null, 'HKD', { HKD: 0.9 }), 0); // 金额缺失归零
    assert.strictEqual(L.amountAtRates('50', 'HKD', { HKD: 0.8 }), 40); // 字符串金额转数字
    assert.strictEqual(L.amountAtRates(NaN, 'HKD', { HKD: 0.9 }), 0);   // NaN 防御
  });
  test('moneyStr 负数 / 零 / 小数', () => {
    assert.strictEqual(L.moneyStr(-1234.5), '-1,234.5');
    assert.strictEqual(L.moneyStr(0), '0');
    assert.strictEqual(L.moneyStr(1234.567), '1,234.567');
  });
  test('migrateState 保留已存在的 currency 内置分类', () => {
    globalThis.state = freshState({ categories: [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] }] });
    const before = state.categories.length;
    L.migrateState();
    assert.strictEqual(state.categories.length, before);
    assert.strictEqual(state.categories.find(c => c.id === 'currency').tags.length, 3);
  });
});

describe('备份 daysBetweenStr / backup 设置兜底', () => {
  test('daysBetweenStr 同日 / 正负差', () => {
    assert.strictEqual(L.daysBetweenStr('2024-05-01', '2024-05-01'), 0);
    assert.strictEqual(L.daysBetweenStr('2024-05-01', '2024-05-08'), 7);
    assert.strictEqual(L.daysBetweenStr('2024-05-08', '2024-05-01'), -7);
  });
  test('daysBetweenStr 跨月 / 跨年边界', () => {
    assert.strictEqual(L.daysBetweenStr('2024-02-28', '2024-03-01'), 2); // 2024 闰年
    assert.strictEqual(L.daysBetweenStr('2023-12-31', '2024-01-01'), 1);
  });
  test('daysBetweenStr 非法输入返回 null', () => {
    assert.strictEqual(L.daysBetweenStr('', '2024-05-01'), null);
    assert.strictEqual(L.daysBetweenStr('2024-05-01', 'bad'), null);
    assert.strictEqual(L.daysBetweenStr(null, null), null);
  });
  test('migrateState 补全缺失的 backup 设置（默认每天）', () => {
    globalThis.state = freshState({}); // 无 backup 字段
    L.migrateState();
    assert.deepStrictEqual(state.backup, { autoFreq: 'daily', lastBackup: null, lastAutoDownload: null });
  });
  test('migrateState 非法频率归位 daily，合法值保留', () => {
    globalThis.state = freshState({ backup: { autoFreq: 'monthly' } });
    L.migrateState();
    assert.strictEqual(state.backup.autoFreq, 'daily');
    globalThis.state = freshState({ backup: { autoFreq: 'weekly' } });
    L.migrateState();
    assert.strictEqual(state.backup.autoFreq, 'weekly');
    globalThis.state = freshState({ backup: { autoFreq: 'off' } });
    L.migrateState();
    assert.strictEqual(state.backup.autoFreq, 'off');
  });
  test('daysBetweenStr 宽容单数字月日（行为锁定）', () => {
    assert.strictEqual(L.daysBetweenStr('2024-5-1', '2024-5-2'), 1);
  });
});

describe('备份决策 normalizeBackupFreq / hasAnyBackupWorthyData / shouldAutoBackup / backupStaleDays', () => {
  // 带一条资产与指定备份设置的 state 工厂（保证「有数据」前提，便于聚焦频率分支）
  const withBackup = (backup, extra = {}) =>
    freshState(Object.assign({ assets: [{ amount: 100, currency: 'CNY' }], backup }, extra));

  test('阈值常量契约：提醒阈值为 7 天', () => {
    assert.strictEqual(L.BACKUP_STALE_DAYS, 7);
  });

  test('normalizeBackupFreq 白名单归一', () => {
    assert.strictEqual(L.normalizeBackupFreq('daily'), 'daily');
    assert.strictEqual(L.normalizeBackupFreq('weekly'), 'weekly');
    assert.strictEqual(L.normalizeBackupFreq('off'), 'off');
    assert.strictEqual(L.normalizeBackupFreq('monthly'), 'daily'); // 非法字符串
    assert.strictEqual(L.normalizeBackupFreq(undefined), 'daily');
    assert.strictEqual(L.normalizeBackupFreq(null), 'daily');
    assert.strictEqual(L.normalizeBackupFreq(''), 'daily');
  });

  test('backupNoteText 上次备份文案（「备份与导入」与设置弹窗共用）', () => {
    assert.strictEqual(L.backupNoteText(null, '2024-05-01'), '尚未备份过');
    assert.strictEqual(L.backupNoteText(undefined, '2024-05-01'), '尚未备份过');
    assert.strictEqual(L.backupNoteText('', '2024-05-01'), '尚未备份过');
    // 当天备份：带「今天」后缀；历史日期：仅日期本身
    assert.strictEqual(L.backupNoteText('2024-05-01', '2024-05-01'), '上次备份 2024-05-01（今天）');
    assert.strictEqual(L.backupNoteText('2024-04-20', '2024-05-01'), '上次备份 2024-04-20');
  });

  test('hasAnyBackupWorthyData：任一数据源非空即真，全空/缺字段为假', () => {
    assert.strictEqual(L.hasAnyBackupWorthyData(freshState({})), false);
    assert.strictEqual(L.hasAnyBackupWorthyData({}), false);
    assert.strictEqual(L.hasAnyBackupWorthyData(), false);
    assert.strictEqual(L.hasAnyBackupWorthyData(freshState({ assets: [{}] })), true);
    assert.strictEqual(L.hasAnyBackupWorthyData(freshState({ expenses: [{ amount: 5 }] })), true);
    assert.strictEqual(L.hasAnyBackupWorthyData(freshState({ snapshots: [{ month: '2024-01' }] })), true);
    assert.strictEqual(
      L.hasAnyBackupWorthyData(freshState({ assets: [], expenses: [], snapshots: [] })), false);
  });

  test('shouldAutoBackup：关闭或无数据恒否', () => {
    assert.strictEqual(L.shouldAutoBackup(withBackup({ autoFreq: 'off' }), '2024-05-01'), false);
    assert.strictEqual(
      L.shouldAutoBackup(freshState({ backup: { autoFreq: 'daily' } }), '2024-05-01'), false);
  });

  test('shouldAutoBackup daily：从未→是；当天已下→否；隔天→是', () => {
    assert.strictEqual(L.shouldAutoBackup(withBackup({ autoFreq: 'daily' }), '2024-05-01'), true);
    assert.strictEqual(
      L.shouldAutoBackup(withBackup({ autoFreq: 'daily', lastAutoDownload: '2024-05-01' }), '2024-05-01'), false);
    assert.strictEqual(
      L.shouldAutoBackup(withBackup({ autoFreq: 'daily', lastAutoDownload: '2024-04-30' }), '2024-05-01'), true);
  });

  test('shouldAutoBackup weekly：不足 7 天否，满 7 天是', () => {
    const wk = (last) => withBackup({ autoFreq: 'weekly', lastAutoDownload: last });
    assert.strictEqual(L.shouldAutoBackup(wk('2024-04-25'), '2024-05-01'), false); // 恰好 6 天
    assert.strictEqual(L.shouldAutoBackup(wk('2024-04-24'), '2024-05-01'), true);  // 恰好 7 天
  });

  test('shouldAutoBackup：历史日期损坏视为需要备份；缺 backup 对象按默认 daily+从未下载', () => {
    assert.strictEqual(
      L.shouldAutoBackup(withBackup({ autoFreq: 'daily', lastAutoDownload: 'garbage' }), '2024-05-01'), true);
    const noBackupObj = freshState({ assets: [{ amount: 1 }] });
    assert.strictEqual(L.shouldAutoBackup(noBackupObj, '2024-05-01'), true);
    noBackupObj.backup = { autoFreq: 'daily', lastAutoDownload: '2024-05-01' };
    assert.strictEqual(L.shouldAutoBackup(noBackupObj, '2024-05-01'), false);
  });

  test('backupStaleDays：恰好 7 天不提醒，8 天提醒并返回天数', () => {
    assert.strictEqual(
      L.backupStaleDays(withBackup({ autoFreq: 'daily', lastBackup: '2024-04-24' }), '2024-05-01'), null);
    assert.strictEqual(
      L.backupStaleDays(withBackup({ autoFreq: 'daily', lastBackup: '2024-04-23' }), '2024-05-01'), 8);
  });

  test('backupStaleDays：无数据 / 从未备份 / 日期损坏 → null 不打扰', () => {
    assert.strictEqual(
      L.backupStaleDays(freshState({ backup: { autoFreq: 'daily', lastBackup: '2020-01-01' } }), '2024-05-01'), null);
    assert.strictEqual(
      L.backupStaleDays(withBackup({ autoFreq: 'daily', lastBackup: null }), '2024-05-01'), null);
    assert.strictEqual(
      L.backupStaleDays(withBackup({ autoFreq: 'daily', lastBackup: 'bad-date' }), '2024-05-01'), null);
  });
});

describe('汇率刷新提示决策 rateFallbackNotice（统一提示便条）', () => {
  test('有缓存可回退 → 中性便条 info「使用缓存汇率」（注意但不报警）', () => {
    assert.deepStrictEqual(L.rateFallbackNotice(true), { msg: '使用缓存汇率', type: 'info' });
  });

  test('连缓存都没有 → 报警便条 error「汇率获取失败」', () => {
    assert.deepStrictEqual(L.rateFallbackNotice(false), { msg: '汇率获取失败', type: 'error' });
  });

  test('返回对象形状稳定：msg + type 两字段，供 fetchRates 直接展开给 toast', () => {
    for (const v of [true, false]) {
      const n = L.rateFallbackNotice(v);
      assert.strictEqual(typeof n.msg, 'string');
      assert.ok(n.msg.length > 0);
      assert.ok(['info', 'error'].includes(n.type));
      assert.strictEqual(Object.keys(n).length, 2);
    }
    // 两种分支的 type 必须不同，否则语义色失去区分意义
    assert.notStrictEqual(L.rateFallbackNotice(true).type, L.rateFallbackNotice(false).type);
  });
});

describe('金额格式化 money2（从 index.html 下沉，表格/对比/tooltip 展示态共用）', () => {
  test('千分位 + 恒两位小数，与 formatCNY 差异仅在无 ¥ 符号', () => {
    assert.strictEqual(L.money2(1234.5), '1,234.50');
    assert.strictEqual(L.money2(1234567.891), '1,234,567.89');
    assert.strictEqual(L.money2(0), '0.00');
    assert.strictEqual(L.money2(-9876.5), '-9,876.50');
  });

  test('字符串数字与非法输入的防御：走 Number() 强转（null→0）', () => {
    assert.strictEqual(L.money2('1234.5'), '1,234.50');
    assert.strictEqual(L.money2(null), '0.00');
  });

  test('非有限值（undefined/NaN/Infinity）返回空串，不渲染出 NaN', () => {
    assert.strictEqual(L.money2(undefined), '');
    assert.strictEqual(L.money2(NaN), '');
    assert.strictEqual(L.money2(Infinity), '');
    assert.strictEqual(L.money2('abc'), '');
  });
});

describe('颜色数学 hexToRgba（从 index.html 下沉，chips ring 半透明描边用）', () => {
  test('#RRGGBB + alpha → rgba() 四段整数', () => {
    assert.strictEqual(L.hexToRgba('#ff0000', 0.45), 'rgba(255,0,0,0.45)');
    assert.strictEqual(L.hexToRgba('#00bfff', 1), 'rgba(0,191,255,1)');
    assert.strictEqual(L.hexToRgba('#B4841A', 0), 'rgba(180,132,26,0)');
  });
});

describe('消费月份列表 expenseMonths（月份筛选与趋势维度下拉共用）', () => {
  test('去重、降序、按 YYYY-MM 截取', () => {
    const exps = [
      { date: '2024-03-15' }, { date: '2024-01-02' },
      { date: '2024-03-20' }, { date: '2024-12-31' },
    ];
    assert.deepStrictEqual(L.expenseMonths(exps), ['2024-12', '2024-03', '2024-01']);
  });

  test('防御缺失/空 date 的脏记录（原先图表下拉那份不防御会抛异常）', () => {
    assert.deepStrictEqual(L.expenseMonths([{ date: '' }, {}, { date: '2024-05-01' }]), ['2024-05']);
    assert.deepStrictEqual(L.expenseMonths([]), []);
    assert.deepStrictEqual(L.expenseMonths(null), []);
    assert.deepStrictEqual(L.expenseMonths(undefined), []);
  });
});

describe('消费标签筛选下拉（类别作不可选分组头）tagFilterValue / parseTagFilter / expenseTagFilterGroups / hasTagFilterOption', () => {
  test('编码与解码互逆：选中值 = catId + 分隔符 + tag', () => {
    assert.deepStrictEqual(L.parseTagFilter(L.tagFilterValue('c1', '餐饮')), { catId: 'c1', tag: '餐饮' });
    assert.deepStrictEqual(L.parseTagFilter(L.tagFilterValue('1726-a', '交通·地铁')), { catId: '1726-a', tag: '交通·地铁' });
  });

  test('标签含分隔符/HTML 特殊字符时解码无损（解析取首个分隔符，tag 保尾）', () => {
    const weird = 'a\u0001b"\'<&>';
    assert.deepStrictEqual(L.parseTagFilter(L.tagFilterValue('c1', weird)), { catId: 'c1', tag: weird });
    assert.deepStrictEqual(L.parseTagFilter(L.tagFilterValue('c1', '含分隔符\u0001')), { catId: 'c1', tag: '含分隔符\u0001' });
  });

  test('空值/缺分隔符/空分类 id/空标签一律解码为 null（视作未筛选）', () => {
    assert.strictEqual(L.parseTagFilter(''), null);
    assert.strictEqual(L.parseTagFilter(null), null);
    assert.strictEqual(L.parseTagFilter(undefined), null);
    assert.strictEqual(L.parseTagFilter('餐饮'), null, '缺分隔符');
    assert.strictEqual(L.parseTagFilter('\u0001餐饮'), null, '分类 id 为空');
    assert.strictEqual(L.parseTagFilter('c1\u0001'), null, '标签为空');
  });

  test('expenseTagFilterGroups 保持分类顺序、tags 深拷贝、缺失归空数组', () => {
    const cats = [
      { id: 'a', name: '餐饮', tags: ['早餐'] },
      { id: 'b', name: '交通' },
      { id: 'c', name: '购物', tags: null },
    ];
    const groups = L.expenseTagFilterGroups(cats);
    assert.deepStrictEqual(groups.map(g => g.id), ['a', 'b', 'c'], '顺序保留');
    assert.deepStrictEqual(groups.map(g => g.tags), [['早餐'], [], []], 'tags 缺失/null 归空数组');
    groups[0].tags.push('改写分组');
    assert.deepStrictEqual(cats[0].tags, ['早餐'], '分组持有拷贝，不反向污染 state');
    assert.deepStrictEqual(L.expenseTagFilterGroups(null), []);
    assert.deepStrictEqual(L.expenseTagFilterGroups(undefined), []);
  });

  test('hasTagFilterOption：有效选中为真，分类被删/标签改名后为假', () => {
    const groups = L.expenseTagFilterGroups([
      { id: 'a', name: '餐饮', tags: ['早餐', '外卖'] },
      { id: 'b', name: '交通', tags: ['地铁'] },
    ]);
    assert.strictEqual(L.hasTagFilterOption(groups, L.tagFilterValue('b', '地铁')), true);
    assert.strictEqual(L.hasTagFilterOption(groups, L.tagFilterValue('gone', '早餐')), false, '分类已删');
    assert.strictEqual(L.hasTagFilterOption(groups, L.tagFilterValue('a', '午餐')), false, '标签已改名/移出');
    assert.strictEqual(L.hasTagFilterOption(groups, ''), false, '「全部标签」不算选项');
    assert.strictEqual(L.hasTagFilterOption(groups, 'no-sep'), false, '非编码值');
    assert.strictEqual(L.hasTagFilterOption(null, L.tagFilterValue('a', '早餐')), false);
    assert.strictEqual(L.hasTagFilterOption([{ id: 'x', name: 'X', tags: null }], L.tagFilterValue('x', 't')), false, 'tags 为 null 不抛异常');
  });
});

describe("hasAnyRatedAsset / cashRatioPct（从 index.html 下沉，「设了利率才显示」判定与现金比例展示单一来源）", () => {
  test('hasAnyRatedAsset：任一资产 Min/Max > 0 即真', () => {
    assert.strictEqual(L.hasAnyRatedAsset([
      { expectedRateMin: 0, expectedRateMax: 0 },
      { expectedRateMin: 2.5, expectedRateMax: 4 },
    ]), true);
  });

  test('hasAnyRatedAsset：全未设置/空表/缺失入参为假', () => {
    assert.strictEqual(L.hasAnyRatedAsset([{ expectedRateMin: 0, expectedRateMax: null }]), false);
    assert.strictEqual(L.hasAnyRatedAsset([]), false);
    assert.strictEqual(L.hasAnyRatedAsset(null), false);
    assert.strictEqual(L.hasAnyRatedAsset(undefined), false);
  });

  test('hasAnyRatedAsset：脏值行为与旧内联实现一致', () => {
    // '' 与 NaN 不误报
    assert.strictEqual(L.hasAnyRatedAsset([{ expectedRateMin: '', expectedRateMax: NaN }]), false);
    // 数字字符串按关系比较隐式转数字（'3' > 0 === true），与下沉前两份内联实现行为一致，锁定防漂移
    assert.strictEqual(L.hasAnyRatedAsset([{ expectedRateMin: '3', expectedRateMax: 0 }]), true);
  });

  test('cashRatioPct：取整展示值与钳制边界', () => {
    assert.strictEqual(L.cashRatioPct({ cashRatio: 20 }), 20);
    assert.strictEqual(L.cashRatioPct({ cashRatio: 33.3 }), 33); // 四舍五入取整
    assert.strictEqual(L.cashRatioPct({ cashRatio: 150 }), 100); // 越界钳制
    assert.strictEqual(L.cashRatioPct({}), 100);                 // 缺失默认全额现金
  });
});

describe('coveragePct（覆盖标尺：分子月收益 ÷ 预期月消费，口径无关）', () => {
  test('形参名 amount：分子可为现金或总收益（默认口径 total），不得命名成 cashMonthly 误导调用方', () => {
    assert.match(L.coveragePct.toString(), /function coveragePct\(amount, expectation\)/);
  });

  test('常规换算，可超过 100%', () => {
    assert.ok(approx(L.coveragePct(6240, 10000), 62.4));
    assert.ok(approx(L.coveragePct(12500, 10000), 125));
    assert.ok(approx(L.coveragePct(10000, 10000), 100));
    // 字符串数字防御（导入数据同源口径）
    assert.ok(approx(L.coveragePct('624', '1000'), 62.4));
  });

  test('未设/非法预期 → null（无法计量, UI 显示邀请态）', () => {
    assert.strictEqual(L.coveragePct(5000, 0), null);
    assert.strictEqual(L.coveragePct(5000, null), null);
    assert.strictEqual(L.coveragePct(5000, undefined), null);
    assert.strictEqual(L.coveragePct(5000, -100), null);
    assert.strictEqual(L.coveragePct(5000, 'abc'), null);
  });

  test('现金收益非法/负值归 0 而非 NaN（防御）', () => {
    assert.strictEqual(L.coveragePct(0, 10000), 0);
    assert.strictEqual(L.coveragePct(null, 10000), 0);
    assert.strictEqual(L.coveragePct(NaN, 10000), 0);
    assert.strictEqual(L.coveragePct(undefined, 10000), 0);
    assert.strictEqual(L.coveragePct(-5, 10000), 0);
  });
});

describe('incomeGap（收益−预期差额口径：覆盖标尺读数单一来源）', () => {
  test('盈余分支：ok=true / word=盈余 / 差额取整', () => {
    const g = L.incomeGap(12500, 10000);
    assert.strictEqual(g.ok, true);
    assert.strictEqual(g.word, '盈余');
    assert.strictEqual(g.amt, 2500);
    assert.ok(approx(g.pct, 25));
  });

  test('缺口分支：ok=false / word=缺口', () => {
    const g = L.incomeGap(6240, 10000);
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.word, '缺口');
    assert.strictEqual(g.amt, 3760);
    assert.ok(approx(g.pct, 37.6));
  });

  test('恰好打平算盈余（gap >= 0），差额为 0', () => {
    const g = L.incomeGap(10000, 10000);
    assert.strictEqual(g.ok, true);
    assert.strictEqual(g.amt, 0);
    assert.strictEqual(g.pct, 0);
  });

  test('非法预期 → null（调用方回退邀请态）；NaN 金额归 0 不产出 NaN 字符串', () => {
    assert.strictEqual(L.incomeGap(5000, 0), null);
    assert.strictEqual(L.incomeGap(5000, null), null);
    assert.strictEqual(L.incomeGap(5000, 'abc'), null);
    const g = L.incomeGap(NaN, 10000);
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.amt, 10000, 'NaN 金额按 0 参与差额，不产出 NaN');
  });
});

describe('coverShortfallPrincipal（覆盖缺口还需本金：按现有实际收益率线性外推）', () => {
  test('形参自解释：月收益 / 预期 / 年收益 / 有息本金，调用方按口径传入总或现金两套值', () => {
    assert.match(L.coverShortfallPrincipal.toString(), /function coverShortfallPrincipal\(monthly, expectation, annual, principal\)/);
  });

  test('常规外推：need = 缺口月 ×12 ÷ 实际年化（年收益 ÷ 有息本金），rate 同源一次给出', () => {
    // 月收益 6240、预期 10000，年收益 74880、基地 100 万 → 缺口 3760×12×1e6/74880
    const r = L.coverShortfallPrincipal(6240, 10000, 74880, 1000000);
    assert.ok(approx(r.need, 3760 * 12 * 1000000 / 74880));
    assert.ok(approx(r.rate, 7.488), 'rate 为实际年化百分比，与 need 同源（展示层不得重算）');
    // 字符串数字防御（导入数据同源口径）
    const rs = L.coverShortfallPrincipal('6240', '10000', '74880', '1000000');
    assert.ok(approx(rs.need, 3760 * 12 * 1000000 / 74880));
  });

  test('已覆盖/打平 → need=null（UI 不挂 Tips，只在缺口分支出现）', () => {
    assert.strictEqual(L.coverShortfallPrincipal(12500, 10000, 150000, 1000000).need, null);
    assert.strictEqual(L.coverShortfallPrincipal(10000, 10000, 120000, 1000000).need, null);
  });

  test('未设/非法预期 → need=null（调用方回退邀请态）；月收益 NaN 按 0 参与不产出 NaN', () => {
    assert.strictEqual(L.coverShortfallPrincipal(5000, 0, 60000, 1000000).need, null);
    assert.strictEqual(L.coverShortfallPrincipal(5000, null, 60000, 1000000).need, null);
    assert.strictEqual(L.coverShortfallPrincipal(5000, 'abc', 60000, 1000000).need, null);
    assert.ok(approx(L.coverShortfallPrincipal(NaN, 10000, 74880, 1000000).need, 10000 * 12 * 1000000 / 74880));
  });

  test('年收益/基地非法或非正 → need=Infinity（收益率≤0 无法外推，UI 显示兜底一句）', () => {
    for (const [a, p] of [[0, 1000000], [-100, 1000000], [74880, 0], [NaN, 1000000], [74880, null]]) {
      assert.strictEqual(L.coverShortfallPrincipal(6240, 10000, a, p).need, Infinity);
    }
  });

  test('rate 兜底：基地为 0 或非有限时归 0（不产出 NaN/Infinity 文案）', () => {
    assert.strictEqual(L.coverShortfallPrincipal(6240, 10000, 74880, 0).rate, 0);
    assert.strictEqual(L.coverShortfallPrincipal(6240, 10000, NaN, 1000000).rate, 0);
    assert.strictEqual(L.coverShortfallPrincipal(6240, 10000, Infinity, 1000000).rate, 0);
  });

  test('ratedPrincipalCNY 只算有息资产（跟随利率档），零利率不摊薄收益率', () => {
    const assets = [
      { amount: 1000, currency: 'CNY', expectedRateMin: 5, expectedRateMax: 5 },
      { amount: 500, currency: 'CNY', expectedRateMin: 0, expectedRateMax: 0 },
      { amount: 100, currency: 'USD', expectedRateMin: 0, expectedRateMax: 10 },
    ];
    globalThis.incomeMode = 'min';
    assert.ok(approx(L.ratedPrincipalCNY(assets), 1000), 'min 档只有第一笔算有息');
    globalThis.incomeMode = 'max';
    assert.ok(approx(L.ratedPrincipalCNY(assets), 1000 + 720), 'max 档含美元资产（按汇率折算）');
    assert.strictEqual(L.ratedPrincipalCNY([]), 0);
    assert.strictEqual(L.ratedPrincipalCNY(null), 0);
  });
});

describe('sumAssetIncomes（两口径收益合计：报头副行/收益摘要/覆盖标尺共用）', () => {
  test('多资产合计含安全边际与现金拆分，衍生月/日值与单资产算法同式', () => {
    const s = L.sumAssetIncomes([
      { amount: 1200, currency: 'CNY', expectedRateMin: 5, expectedRateMax: 10, cashRatio: 50 },
      { amount: 800, currency: 'CNY', expectedRateMin: 5, expectedRateMax: 10, cashRatio: 100 },
    ]);
    // max 口径: 年化分别 120 + 80 = 200; 现金 60 + 80 = 140
    assert.ok(approx(s.annual, 200));
    assert.ok(approx(s.cashAnnual, 140));
    assert.ok(approx(s.monthly, 200 / 12));
    assert.ok(approx(s.daily, 200 / 365));
    assert.ok(approx(s.cashMonthly, 140 / 12));
  });

  test('未设利率/空表/缺失入参均归零，不产出 NaN', () => {
    const zero = L.sumAssetIncomes([{ amount: 500, currency: 'CNY', expectedRateMin: 0, expectedRateMax: 0 }]);
    assert.strictEqual(zero.annual, 0);
    assert.strictEqual(zero.cashMonthly, 0);
    for (const key of ['annual', 'cashAnnual', 'monthly', 'daily', 'cashMonthly']) {
      assert.strictEqual(L.sumAssetIncomes([])[key], 0);
      assert.strictEqual(L.sumAssetIncomes(null)[key], 0);
    }
  });

  test('随 incomeMode 切换口径（读全局 let，与浏览器行为一致）', () => {
    const assets = [{ amount: 1200, currency: 'CNY', expectedRateMin: 5, expectedRateMax: 10 }];
    globalThis.incomeMode = 'min';
    const minRun = L.sumAssetIncomes(assets);
    globalThis.incomeMode = 'max';
    const maxRun = L.sumAssetIncomes(assets);
    assert.ok(approx(minRun.annual, 60));
    assert.ok(approx(maxRun.annual, 120));
  });

  test('负收益资产计入合计（统一为报头口径，不再像旧摘要 filter 掉）', () => {
    // 表单允许输负利率（仅校验 min<=max 顺序）、导入数据亦不鍴制——
    // 旧 renderIncomeTab 曾 filter(i.annual>0) 把负值剔除，与报头各算各的；现统一为全量累加
    const s = L.sumAssetIncomes([
      { amount: 1000, currency: 'CNY', expectedRateMin: 8, expectedRateMax: 8 },
      { amount: 1000, currency: 'CNY', expectedRateMin: -2, expectedRateMax: -2, cashRatio: 100 },
    ]);
    assert.ok(approx(s.annual, 80 - 20));
    assert.ok(approx(s.cashAnnual, 80 - 20));
  });
});

describe('三态排序状态机 nextSortState（资产/消费列表共用）', () => {
  const cycle = (by, dir, field, flipSticky) => L.nextSortState(by, dir, field, flipSticky);

  test('同列点击循环：升序 → 降序 → 取消（恢复自然顺序）', () => {
    assert.deepStrictEqual(cycle('amount', 'asc', 'amount', false), { by: 'amount', dir: 'desc' });
    assert.deepStrictEqual(cycle('amount', 'desc', 'amount', false), { by: '', dir: 'asc' });
  });

  test('换列重置为新列升序', () => {
    assert.deepStrictEqual(cycle('name', 'desc', 'amount', false), { by: 'amount', dir: 'asc' });
  });

  test('消费侧粘性翻转（flipSticky=true）：仅翻转方向、不进入取消分支，不修改入参对象', () => {
    assert.deepStrictEqual(cycle('date', 'desc', 'date', true), { by: 'date', dir: 'asc' });
    assert.deepStrictEqual(cycle('date', 'asc', 'date', true), { by: 'date', dir: 'desc' });
    const before = { by: 'date', dir: 'desc' };
    cycle(before.by, before.dir, 'date', true);
    assert.deepStrictEqual(before, { by: 'date', dir: 'desc' }, '入参保持不变（纯函数）');
  });

  test('flipSticky 只对同列生效：换列时等价于普通切换', () => {
    assert.deepStrictEqual(cycle('date', 'desc', 'amount', true), { by: 'amount', dir: 'asc' });
  });
});

describe('消费数据校验 isUntaggedItem / missingTagGroups / setTag / backfillTag（缺标签一键·逐条补齐）', () => {
  const cat = { id: 'c1', name: '债券', tags: ['国债', '可转债'] };

  test('isUntaggedItem 三态：缺 key / 空值 / 陈旧引用都算未归类，合法值不算', () => {
    assert.strictEqual(L.isUntaggedItem({}, 'c1', cat.tags), true, '无该分类 key');
    assert.strictEqual(L.isUntaggedItem({ tags: {} }, 'c1', cat.tags), true);
    assert.strictEqual(L.isUntaggedItem({ tags: { c1: '' } }, 'c1', cat.tags), true, '空串');
    assert.strictEqual(L.isUntaggedItem({ tags: { c1: '已删标签' } }, 'c1', cat.tags), true, '指向已删除标签的陈旧引用');
    assert.strictEqual(L.isUntaggedItem({ tags: { c1: '国债' } }, 'c1', cat.tags), false);
  });

  test('isUntaggedItem 对缺 tags 字段/空入参不抛异常（旧数据与导入数据）', () => {
    assert.strictEqual(L.isUntaggedItem({ tags: null }, 'c1', cat.tags), true);
    assert.strictEqual(L.isUntaggedItem(null, 'c1', cat.tags), true);
    assert.strictEqual(L.isUntaggedItem(undefined, 'c1', cat.tags), true);
    // validTags 缺失按空处理：任何值都视为无效 → 仍归入待校验
    assert.strictEqual(L.isUntaggedItem({ tags: { c1: 'x' } }, 'c1', null), true);
  });

  test('missingTagGroups 只返回有缺口的分组，内置/空标签分类跳过，不改入参', () => {
    const items = [
      { id: 'e1', tags: { c1: '国债' } },
      { id: 'e2', tags: {} },
      { id: 'e3' },
    ];
    const cats = [
      { id: 'currency', name: '货币类型', builtin: true, tags: ['CNY'] },
      { id: 'cEmpty', name: '空分类', tags: [] },
      cat,
      { id: 'c2', name: '渠道', tags: ['微信'] },
    ];
    const itemsBefore = JSON.stringify(items);
    const catsBefore = JSON.stringify(cats);
    const groups = L.missingTagGroups(items, cats);

    assert.deepStrictEqual(groups.map(g => g.catId), ['c1', 'c2'], '有缺口才返回，内置与空标签分类不出现，且保持分类顺序');
    const c1 = groups.find(g => g.catId === 'c1');
    assert.deepStrictEqual(c1.items.map(i => i.id), ['e2', 'e3'], 'e1 已归类不应出现');
    assert.deepStrictEqual(c1.tags, ['国债', '可转债'], '带出分类标签供面板渲染 chips');
    assert.strictEqual(c1.name, '债券');
    assert.strictEqual(groups.find(g => g.catId === 'c2').items.length, 3, '三处都缺该分类标签');

    assert.strictEqual(JSON.stringify(items), itemsBefore, '不改记录');
    assert.strictEqual(JSON.stringify(cats), catsBefore, '不改分类');
    assert.deepStrictEqual(L.missingTagGroups([{ tags: { c1: '国债' } }], [cat]), [], '全归类 → 空数组');
    assert.deepStrictEqual(L.missingTagGroups(null, null), [], '空入参兜底');
  });

  test('setTag 是写标签唯一出口：缺 tags 对象补建、不碰其它分类、空入参不抛', () => {
    const a = {};
    L.setTag(a, 'c1', '国债');
    assert.deepStrictEqual(a.tags, { c1: '国债' });

    const b = { tags: null };
    L.setTag(b, 'c1', '可转债');
    assert.deepStrictEqual(b.tags, { c1: '可转债' });

    const c = { tags: { other: 'x' } };
    L.setTag(c, 'c1', '国债');
    assert.deepStrictEqual(c.tags, { other: 'x', c1: '国债' }, '既有分类值不动');

    L.setTag(null, 'c1', '国债');
    L.setTag(undefined, 'c1', '国债');
  });

  test('backfillTag 只补空缺/陈旧位，不覆盖已归类；返回实际条数且幂等', () => {
    const items = [
      { id: 'a', tags: { c1: '可转债' } },
      { id: 'b', tags: { c1: '' } },
      { id: 'c' },
      { id: 'd', tags: { c1: '已删标签' } },
      { id: 'e', tags: { other: 'x' } },
    ];
    const tagsBefore = cat.tags.slice();
    const n = L.backfillTag(items, 'c1', '国债', cat.tags);

    assert.strictEqual(n, 4, '已归类的 a 不算');
    assert.strictEqual(items[0].tags.c1, '可转债', '绝不覆盖已归类的值');
    assert.strictEqual(items[1].tags.c1, '国债');
    assert.strictEqual(items[2].tags.c1, '国债');
    assert.strictEqual(items[3].tags.c1, '国债', '陈旧引用按未归类处理');
    assert.strictEqual(items[4].tags.c1, '国债');
    assert.strictEqual(items[4].tags.other, 'x', '其它分类的值不动');
    assert.deepStrictEqual(cat.tags, tagsBefore, '不改 validTags 入参');

    assert.strictEqual(L.backfillTag(items, 'c1', '可转债', cat.tags), 0, '幂等：再跑 0 条');
    assert.strictEqual(items[1].tags.c1, '国债', '幂等：不被第二次调用改写');
    assert.strictEqual(L.backfillTag(null, 'c1', '国债', cat.tags), 0, '空入参兜底');
    assert.strictEqual(L.backfillTag([{}, {}], 'c1', '国债', cat.tags), 2);
  });
});

describe('快照对比默认基准 defaultCompareBaseMonth（默认最近两个月）', () => {
  const snaps = (...months) => months.map(m => ({ month: m }));

  test('默认基准取次新快照月，与最新月构成最近两个月', () => {
    assert.strictEqual(L.defaultCompareBaseMonth(snaps('2024-01', '2024-02', '2024-03')), '2024-02');
    assert.strictEqual(L.defaultCompareBaseMonth(snaps('2023-05', '2023-11', '2024-03', '2024-04')), '2024-03');
  });

  test('恰好两个快照时取最早月', () => {
    assert.strictEqual(L.defaultCompareBaseMonth(snaps('2024-01', '2024-07')), '2024-01');
  });

  test('不足两个快照返回 null（不凭空造月）', () => {
    assert.strictEqual(L.defaultCompareBaseMonth(snaps('2024-01')), null);
    assert.strictEqual(L.defaultCompareBaseMonth([]), null);
    assert.strictEqual(L.defaultCompareBaseMonth(null), null);
  });
});

describe('行内金额编辑键位语义 inlineEditKeyAction', () => {
  test('主键盘 Enter 仅保存当前项', () => {
    assert.strictEqual(L.inlineEditKeyAction('Enter', 'Enter'), 'commit');
  });

  test('小键盘 Enter 等同 Tab：保存并跳到下一行', () => {
    assert.strictEqual(L.inlineEditKeyAction('Enter', 'NumpadEnter'), 'jump');
  });

  test('Tab 跳转、Escape 取消', () => {
    assert.strictEqual(L.inlineEditKeyAction('Tab', 'Tab'), 'jump');
    assert.strictEqual(L.inlineEditKeyAction('Escape', 'Escape'), 'cancel');
  });

  test('其它键不处理（返回 null）', () => {
    assert.strictEqual(L.inlineEditKeyAction('a', 'KeyA'), null);
    assert.strictEqual(L.inlineEditKeyAction('ArrowDown', 'ArrowDown'), null);
  });
});

describe('长按送达资产页 modePressProgress / modePressDecision', () => {
  const MS = L.MODE_PRESS_MS;

  test('按住时长按比例推进（供进度动画取宽度）', () => {
    assert.strictEqual(L.modePressProgress(0), 0);
    assert.strictEqual(L.modePressProgress(MS / 2), 0.5);
    assert.strictEqual(L.modePressProgress(MS), 1);
  });

  test('满时长判定：松手时按满才送达', () => {
    assert.strictEqual(L.modePressDecision(MS - 1), 'hint');
    assert.strictEqual(L.modePressDecision(MS), 'enter');
    assert.strictEqual(L.modePressDecision(MS + 400), 'enter', '按过头也算送达');
  });

  test('短击给一句提示（教会长按），没有按下时长则不响应', () => {
    assert.strictEqual(L.modePressDecision(150), 'hint');
    assert.strictEqual(L.modePressDecision(1), 'hint', '真按过一下就该知道为什么要长按');
    assert.strictEqual(L.modePressDecision(0), 'ignore');
  });

  test('边界：负值/NaN/缺失均归零，不推进也不送达', () => {
    assert.strictEqual(L.modePressProgress(-120), 0);
    assert.strictEqual(L.modePressProgress(NaN), 0);
    assert.strictEqual(L.modePressProgress(undefined), 0);
    assert.strictEqual(L.modePressProgress(MS * 99), 1, '超时后仍以 1 封顶，不溢出进度条');
    assert.strictEqual(L.modePressDecision(NaN), 'ignore');
    assert.strictEqual(L.modePressDecision(undefined), 'ignore');
  });

  test('提示文案里的秒数由阈值派生（整数秒不带小数尾巴，非整数补一位）', () => {
    assert.strictEqual(L.modePressHint(), '长按 ' + MS / 1000 + ' 秒进入资产页', '文案与常量同源：改阈值即改文案');
    assert.strictEqual(L.modePressHint(1500), '长按 1.5 秒进入资产页');
    assert.strictEqual(L.modePressHint(1000), '长按 1 秒进入资产页', '整数秒不带 .0');
  });
});

describe('长按判定（pill 长按改名 / 资产入口共用同一套状态机）', () => {
  // 分类卡片上的 ✎ 图标去掉了：太小、也把每一枚胶囊都变成「带控件的样子」。
  // 改成长按整枚胶囊就地改名——判定与资产入口的长按同源，只把阈值参数化。
  test('阈值可传：同一套判定服务不同场景（改名给得更短）', () => {
    assert.strictEqual(L.TAG_PRESS_MS, 600);
    assert.strictEqual(L.pressDecision(700, 600), 'done');
    assert.strictEqual(L.pressDecision(300, 600), 'short');
    assert.strictEqual(L.pressDecision(0, 600), 'ignore');
    // 不传阈值时退回资产入口那一档（既有语义不变）
    assert.strictEqual(L.pressDecision(L.MODE_PRESS_MS), 'done');
    assert.strictEqual(L.pressDecision(L.MODE_PRESS_MS - 1), 'short');
  });

  test('进度比例按传入阈值算，封顶不溢出', () => {
    assert.strictEqual(L.pressProgress(300, 600), 0.5);
    assert.strictEqual(L.pressProgress(9999, 600), 1);
    assert.strictEqual(L.pressProgress(-5, 600), 0);
    // 脏阈值退回资产入口那一档，不产生 NaN/Infinity
    assert.strictEqual(L.pressProgress(500, 0), L.pressProgress(500, L.MODE_PRESS_MS));
    assert.strictEqual(L.pressProgress(500, NaN), L.pressProgress(500, L.MODE_PRESS_MS));
  });
});

describe('气泡定位 tipBubblePos（脱离祖先层叠上下文，按视口定位）', () => {
  // 用户实测：收益测算里「缺口」旁的 ? hover 后，气泡下半被下面那张卡片盖住。
  // 根因是卡片有 backdrop-filter 会自成层叠上下文，气泡的 z-index 只在自己卡片内有效。
  // 故气泡改为 position:fixed + 按视口定位；这里守的是「不越出视口」这条硬约束。
  const anchorRect = { left: 700, top: 300, right: 715, bottom: 315 };
  const vp = { w: 1280, h: 720 };

  test('默认挂在锚点下方、与锚点左对齐', () => {
    const p = L.tipBubblePos(anchorRect, 240, 80, vp);
    assert.strictEqual(p.left, 700);
    assert.ok(p.top >= anchorRect.bottom, '落在锚点下方');
  });

  test('底部放不下时翻到锚点上方（弹窗里靠下的 ? 不会掉出视口）', () => {
    const low = { left: 400, top: 660, right: 415, bottom: 675 };
    const p = L.tipBubblePos(low, 240, 100, vp);
    assert.ok(p.top + 100 <= vp.h, `气泡底部 ${p.top + 100} 越出视口 ${vp.h}`);
    assert.ok(p.top <= low.top, '翻到锚点上方');
  });

  test('右侧放不下时向左收（气泡不越出右边缘）', () => {
    const right = { left: 1250, top: 300, right: 1265, bottom: 315 };
    const p = L.tipBubblePos(right, 240, 80, vp);
    assert.ok(p.left + 240 <= vp.w, `气泡右缘 ${p.left + 240} 越出视口 ${vp.w}`);
    assert.ok(p.left >= 0, '也不得被推到负数');
  });

  test('气泡比视口还宽时贴左边并从视口左缘起算（不让它跑到负坐标）', () => {
    const p = L.tipBubblePos(anchorRect, 2000, 80, { w: 400, h: 720 });
    assert.strictEqual(p.left, 8);
  });

  test('脏输入不产出 NaN', () => {
    for (const bad of [null, undefined, {}, { left: NaN }]) {
      const p = L.tipBubblePos(bad, NaN, NaN, null);
      assert.ok(Number.isFinite(p.left) && Number.isFinite(p.top), `${JSON.stringify(bad)} → ${JSON.stringify(p)}`);
    }
  });
});

describe('台灯掠光 lampEnabled / lampPos（跟随指针的纸面光）', () => {
  test('指针坐标 → 视口百分比（CSS 直接可用）', () => {
    assert.deepStrictEqual(L.lampPos(500, 250, 1000, 500), { x: 50, y: 50 });
    assert.deepStrictEqual(L.lampPos(0, 0, 1000, 500), { x: 0, y: 0 });
    assert.deepStrictEqual(L.lampPos(1000, 500, 1000, 500), { x: 100, y: 100 });
  });

  test('越界坐标夹在 0~100（指针在窗口外时不该把光晕送出纸面）', () => {
    assert.deepStrictEqual(L.lampPos(-40, 900, 1000, 500), { x: 0, y: 100 });
    assert.deepStrictEqual(L.lampPos(99999, -1, 1000, 500), { x: 100, y: 0 });
  });

  test('尺寸未知/坐标非法一律居中兜底（NaN% 会让整条 gradient 失效）', () => {
    assert.deepStrictEqual(L.lampPos(100, 100, 0, 0), { x: 50, y: 50 });
    assert.deepStrictEqual(L.lampPos(NaN, undefined, 1000, 500), { x: 50, y: 50 });
    assert.deepStrictEqual(L.lampPos(100, 100, null, undefined), { x: 50, y: 50 });
    assert.deepStrictEqual(L.lampPos(Infinity, 100, 1000, 500), { x: 50, y: 20 });
  });

  test('是否点灯：减动效 / 粗指针（触屏无悬停）/ 页面不可见 时都不跟', () => {
    assert.strictEqual(L.lampEnabled(), true, '无参数也不抛错，默认跟随');
    assert.strictEqual(L.lampEnabled({}), true);
    assert.strictEqual(L.lampEnabled({ reducedMotion: true }), false, '明确要求安静就不点灯');
    assert.strictEqual(L.lampEnabled({ coarsePointer: true }), false, '触屏没有悬停');
    assert.strictEqual(L.lampEnabled({ hidden: true }), false, '页面不可见时不必描');
    assert.strictEqual(L.lampEnabled({ reducedMotion: false, coarsePointer: false, hidden: false }), true);
  });
});

describe('堆叠柱标签排序 sortTagsByTotal（历史净值/消费趋势共用）', () => {
  const cat = { id: 'c', tags: ['a', 'b', 'c'] };

  test('按各标签跨月合计降序（大的放柱底）', () => {
    assert.deepStrictEqual(L.sortTagsByTotal(cat, [{ a: 1, b: 2, c: 3 }]), ['c', 'b', 'a']);
    assert.deepStrictEqual(
      L.sortTagsByTotal(cat, [{ a: 1, b: 5, c: 2 }, { a: 9, b: 1, c: 0 }]),
      ['a', 'b', 'c']);
  });

  test('合计相同保持 cat.tags 原顺序（稳定）', () => {
    assert.deepStrictEqual(L.sortTagsByTotal(cat, [{ a: 2, b: 2, c: 2 }]), ['a', 'b', 'c']);
  });

  test('月份映射缺失/脏值按 0 计，不产出 NaN', () => {
    assert.deepStrictEqual(L.sortTagsByTotal(cat, [null, { a: undefined, b: 3 }]), ['b', 'a', 'c']);
    assert.deepStrictEqual(L.sortTagsByTotal(cat, undefined), ['a', 'b', 'c']);
  });

  test('不修改 cat.tags 入参', () => {
    const tags = ['a', 'b', 'c'];
    L.sortTagsByTotal({ id: 'c', tags }, [{ a: 3 }]);
    assert.deepStrictEqual(tags, ['a', 'b', 'c']);
  });

  test('cat 缺失或 tags 为空返回 []', () => {
    assert.deepStrictEqual(L.sortTagsByTotal(null, []), []);
    assert.deepStrictEqual(L.sortTagsByTotal({ tags: null }, []), []);
  });
});

// ========== 所选标签的钱 ÷ 预期月消费（读数行唯一口径）==========
describe('pruneRunwayTags（标签引用归一/清理：迁移与分类 CRUD 共用）', () => {
  const cats = [
    { id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD'] },
    { id: 'c1', name: '资产类型', tags: ['活期现金', '定期存款'] },
  ];

  test('非数组归零', () => {
    assert.deepStrictEqual(L.pruneRunwayTags(null, cats), []);
    assert.deepStrictEqual(L.pruneRunwayTags('x', cats), []);
    assert.deepStrictEqual(L.pruneRunwayTags(undefined, cats), []);
  });

  test('丢弃畸形项与指向已不存在分类/标签的引用', () => {
    const out = L.pruneRunwayTags([
      null, 'x', {}, { catId: 'c1' }, { tag: '活期现金' }, { catId: 1, tag: '活期现金' },
      { catId: 'c9', tag: '活期现金' },
      { catId: 'c1', tag: '已删标签' },
      { catId: 'c1', tag: '活期现金' },
    ], cats);
    assert.deepStrictEqual(out, [{ catId: 'c1', tag: '活期现金' }]);
  });

  test('去重保序', () => {
    const out = L.pruneRunwayTags([
      { catId: 'c1', tag: '定期存款' },
      { catId: 'c1', tag: '活期现金' },
      { catId: 'c1', tag: '定期存款' },
    ], cats);
    assert.deepStrictEqual(out, [
      { catId: 'c1', tag: '定期存款' },
      { catId: 'c1', tag: '活期现金' },
    ]);
  });

  test('categories 缺失/损坏时不崩，返回 []', () => {
    assert.deepStrictEqual(L.pruneRunwayTags([{ catId: 'c1', tag: 'a' }], null), []);
    assert.deepStrictEqual(L.pruneRunwayTags([{ catId: 'c1', tag: 'a' }], [{ id: 'c1', tags: null }]), []);
  });
});

describe('标签改名（引用迁移，不是删除重建）', () => {
  // 分类/标签列表里把「活期现金」改成「现金类」，旧名已不在列表里——若按「无效引用」清理，
  // 资产/消费上的归类会被静默清空（分布图与读数卡随之失真）。改名必须迁移引用。
  test('migrateTagRefs 只迁移同分类同名的引用，返回迁移条数', () => {
    const items = [
      { tags: { c1: '活期现金', c2: '低风险' } },
      { tags: { c1: '权益基金' } },
      { tags: { c1: '活期现金' } },
    ];
    assert.strictEqual(L.migrateTagRefs(items, 'c1', '活期现金', '现金类'), 2);
    assert.deepStrictEqual(items.map((i) => i.tags.c1), ['现金类', '权益基金', '现金类']);
    assert.strictEqual(items[0].tags.c2, '低风险', '其它分类的引用不受影响');
  });

  test('migrateTagRefs 容错：非数组 / 空项 / 无 tags，均不崩且不计入', () => {
    assert.strictEqual(L.migrateTagRefs(null, 'c1', 'a', 'b'), 0);
    assert.strictEqual(L.migrateTagRefs(undefined, 'c1', 'a', 'b'), 0);
    assert.strictEqual(L.migrateTagRefs([null, 'x', {}, { tags: null }, { tags: 'y' }], 'c1', 'a', 'b'), 0);
  });

  test('countTagRefs 统计引用这些标签值的记录数（删除前告知用）', () => {
    const items = [{ tags: { c1: 'a' } }, { tags: { c1: 'b' } }, { tags: { c1: 'c' } }, {}, null];
    assert.strictEqual(L.countTagRefs(items, 'c1', ['a', 'c']), 2);
    assert.strictEqual(L.countTagRefs(items, 'c1', []), 0);
    assert.strictEqual(L.countTagRefs(items, 'c9', ['a']), 0, '别的分类下同名不算');
    assert.strictEqual(L.countTagRefs(null, 'c1', ['a']), 0);
  });

  test('migrateRunwayTagRefs 迁移读数卡所选标签（按分类 + 名字），不改入参', () => {
    const refs = [
      { catId: 'c1', tag: '活期现金' },
      { catId: 'c2', tag: '活期现金' },
      { catId: 'c1', tag: '定期存款' },
    ];
    assert.deepStrictEqual(L.migrateRunwayTagRefs(refs, 'c1', '活期现金', '现金类'), [
      { catId: 'c1', tag: '现金类' },
      { catId: 'c2', tag: '活期现金' },
      { catId: 'c1', tag: '定期存款' },
    ]);
    assert.deepStrictEqual(refs[0], { catId: 'c1', tag: '活期现金' }, '不要就地改入参');
    assert.deepStrictEqual(L.migrateRunwayTagRefs(null, 'c1', 'a', 'b'), []);
    assert.deepStrictEqual(L.migrateRunwayTagRefs([null], 'c1', 'a', 'b'), [null], '畸形项原样保留（交给 prune 清理）');
  });

  test('改名 与 pruneRunwayTags 的组合：选择不被清空（改名先于清理的契约）', () => {
    const cats = [{ id: 'c1', name: '资产类型', tags: ['现金类', '权益基金'] }];
    const renamed = L.migrateRunwayTagRefs([{ catId: 'c1', tag: '活期现金' }], 'c1', '活期现金', '现金类');
    assert.deepStrictEqual(L.pruneRunwayTags(renamed, cats), [{ catId: 'c1', tag: '现金类' }]);
  });
});

describe('runwayExpectationOf（读数卡分母：自定优先，否则全局预期月消费）', () => {
  test('未自定（0/空/非法/负值）时用全局预期月消费', () => {
    assert.strictEqual(L.runwayExpectationOf(0, 5000), 5000);
    assert.strictEqual(L.runwayExpectationOf(null, 5000), 5000);
    assert.strictEqual(L.runwayExpectationOf(undefined, 5000), 5000);
    assert.strictEqual(L.runwayExpectationOf('', 5000), 5000);
    assert.strictEqual(L.runwayExpectationOf('abc', 5000), 5000);
    assert.strictEqual(L.runwayExpectationOf(NaN, 5000), 5000);
    assert.strictEqual(L.runwayExpectationOf(-1, 5000), 5000);
  });

  test('自定值优先于全局（字符串归一为数字）', () => {
    assert.strictEqual(L.runwayExpectationOf(9000, 5000), 9000);
    assert.strictEqual(L.runwayExpectationOf('9000', 5000), 9000);
  });

  test('全局预期未设 → 0：自定值也不放行（读数卡入口就在卡内, 保持整卡不显示）', () => {
    assert.strictEqual(L.runwayExpectationOf(9000, 0), 0);
    assert.strictEqual(L.runwayExpectationOf(9000, null), 0);
    assert.strictEqual(L.runwayExpectationOf(9000, 'abc'), 0);
  });

  test('两处都没设 → 0（UI 据此整卡不显示）', () => {
    assert.strictEqual(L.runwayExpectationOf(0, 0), 0);
    assert.strictEqual(L.runwayExpectationOf(undefined, undefined), 0);
    assert.strictEqual(L.runwayExpectationOf('abc', 'abc'), 0);
  });

  test('runwayExpectationIsCustom 与分母口径同一判定（供读数卡标注「自定」）', () => {
    assert.strictEqual(L.runwayExpectationIsCustom(9000), true);
    assert.strictEqual(L.runwayExpectationIsCustom('9000'), true);
    for (const v of [0, null, undefined, '', 'abc', -1, Infinity]) {
      assert.strictEqual(L.runwayExpectationIsCustom(v), false, `${String(v)} 不算自定`);
    }
  });
});

describe('normalizeRunwayExpectationInput（输入框字符串 → 自定月消费：写入与预览共用）', () => {
  test('千分位/空白/数字串都按数值解析', () => {
    assert.strictEqual(L.normalizeRunwayExpectationInput('9,000', 5000), 9000);
    assert.strictEqual(L.normalizeRunwayExpectationInput(' 9000 ', 5000), 9000);
    assert.strictEqual(L.normalizeRunwayExpectationInput(9000, 5000), 9000);
    assert.strictEqual(L.normalizeRunwayExpectationInput('9000.5', 5000), 9000.5);
  });

  test('空串/非法/零/负值 → 0（未自定，回落全局预期）', () => {
    for (const bad of ['', '   ', null, undefined, 'abc', '0', '0.0', -1, '-9000', 0]) {
      assert.strictEqual(L.normalizeRunwayExpectationInput(bad, 5000), 0, `${String(bad)} → 0`);
    }
  });

  test('与全局预期相同 → 0（按默认存，继续跟着全局走；否则日后改全局本卡会默默钉住旧值）', () => {
    assert.strictEqual(L.normalizeRunwayExpectationInput('5,000', 5000), 0);
    assert.strictEqual(L.normalizeRunwayExpectationInput('5000', 5000), 0);
    assert.strictEqual(L.normalizeRunwayExpectationInput('9000', 5000), 9000);
    // 全局未设时同一个数就是自定值（无「默认」可回落）
    assert.strictEqual(L.normalizeRunwayExpectationInput('5000', 0), 5000);
  });

  test('不与读取侧口径矛盾：归一后的值经 runwayExpectationOf 解析回同一个数', () => {
    const globalExp = 5000;
    for (const raw of ['9,000', '5000', '', 'abc', '-1']) {
      const stored = L.normalizeRunwayExpectationInput(raw, globalExp);
      const effective = L.runwayExpectationOf(stored, globalExp);
      // 存 0 表示按默认（全局值）；否则必须原样读回
      assert.strictEqual(effective, stored > 0 ? stored : globalExp, `raw=${raw}`);
    }
  });
});

describe('runwayLiquidCNY（所选标签匹配的资产折算 CNY 合计）', () => {
  const refs = [{ catId: 'c1', tag: '活期现金' }];

  test('按 catId+tag 精确匹配，外币一律先折成 CNY 再合计（禁用原币值）', () => {
    globalThis.state = freshState(); // HKD 0.9 / USD 7.2
    const assets = [
      { amount: 100, currency: 'CNY', tags: { c1: '活期现金' } },
      { amount: 100, currency: 'HKD', tags: { c1: '活期现金' } },
      { amount: 100, currency: 'USD', tags: { c1: '活期现金' } },
      { amount: 999, currency: 'CNY', tags: { c1: '定期存款' } },
    ];
    const liquid = L.runwayLiquidCNY(assets, refs);
    assert.ok(approx(liquid, 100 + 90 + 720), '按当前汇率折算后相加');
    assert.notStrictEqual(liquid, 300, '不得把外币原币值当 CNY 直接相加');
  });

  test('折算按调用时的汇率重算，不缓存（汇率刷新后读数随之变）', () => {
    globalThis.state = freshState({ rates: { CNY: 1, HKD: 1, USD: 1, fetchedAt: null } });
    const assets = [{ amount: 100, currency: 'HKD', tags: { c1: '活期现金' } }];
    assert.strictEqual(L.runwayLiquidCNY(assets, refs), 100);
    globalThis.state.rates.HKD = 0.92;
    assert.strictEqual(L.runwayLiquidCNY(assets, refs), 92, '同一入参在新汇率下必须给出新结果');
  });

  test('同一资产命中多个所选标签只计一次', () => {
    globalThis.state = freshState();
    const assets = [{ amount: 500, currency: 'CNY', tags: { c1: '活期现金', c2: '货币基金' } }];
    const both = [{ catId: 'c1', tag: '活期现金' }, { catId: 'c2', tag: '货币基金' }];
    assert.strictEqual(L.runwayLiquidCNY(assets, both), 500);
  });

  test('跨分类 = 且：只计同时命中各分类所选标签的资产', () => {
    globalThis.state = freshState();
    const assets = [
      { amount: 100, currency: 'CNY', tags: { c1: '活期现金', c2: '高风险' } },
      { amount: 200, currency: 'CNY', tags: { c1: '定期存款', c2: '低风险' } },
      { amount: 50, currency: 'CNY', tags: { c1: '活期现金', c2: '低风险' } },
      { amount: 70, currency: 'CNY', tags: { c2: '低风险' } },
    ];
    const refs = [{ catId: 'c1', tag: '活期现金' }, { catId: 'c2', tag: '低风险' }];
    assert.strictEqual(L.runwayLiquidCNY(assets, refs), 50);
  });

  test('同分类 = 或：一个资产在一个分类下只有一个标签，同分类取交必然为零', () => {
    globalThis.state = freshState();
    const assets = [
      { amount: 10, currency: 'CNY', tags: { c1: '活期现金' } },
      { amount: 20, currency: 'CNY', tags: { c1: '定期存款' } },
      { amount: 999, currency: 'CNY', tags: { c1: '权益基金' } },
    ];
    const refs = [{ catId: 'c1', tag: '活期现金' }, { catId: 'c1', tag: '定期存款' }];
    assert.strictEqual(L.runwayLiquidCNY(assets, refs), 30);
  });

  test('同分类取并、跨分类取交（组合）', () => {
    globalThis.state = freshState();
    const assets = [
      { amount: 10, currency: 'CNY', tags: { c1: '活期现金', c2: '低风险' } },
      { amount: 20, currency: 'CNY', tags: { c1: '定期存款', c2: '低风险' } },
      { amount: 999, currency: 'CNY', tags: { c1: '活期现金', c2: '高风险' } },
      { amount: 888, currency: 'CNY', tags: { c1: '权益基金', c2: '低风险' } },
      { amount: 777, currency: 'CNY', tags: { c1: '定期存款', c2: '高风险' } },
    ];
    const refs = [
      { catId: 'c1', tag: '活期现金' }, { catId: 'c1', tag: '定期存款' },
      { catId: 'c2', tag: '低风险' },
    ];
    assert.strictEqual(L.runwayLiquidCNY(assets, refs), 30);
  });

  test('未选的分类不参与过滤：只选一个分类时，其余分类不施加任何约束', () => {
    globalThis.state = freshState();
    const assets = [
      { amount: 10, currency: 'CNY', tags: { c1: '活期现金', c2: '低风险' } },
      { amount: 20, currency: 'CNY', tags: { c1: '活期现金', c2: '高风险' } },
      { amount: 999, currency: 'CNY', tags: { c1: '权益基金', c2: '低风险' } },
    ];
    // 只选了 c1：c2 未选 → 不要求「必须是某个风险等级」
    assert.strictEqual(L.runwayLiquidCNY(assets, [{ catId: 'c1', tag: '活期现金' }]), 30);
    // 只选了 c2：c1 未选 → 不要求「必须是某类资产」
    assert.strictEqual(L.runwayLiquidCNY(assets, [{ catId: 'c2', tag: '低风险' }]), 1009);
  });

  test('所选分类里该资产没有对应标签 = 不满足（不能算进去）', () => {
    globalThis.state = freshState();
    const assets = [
      { amount: 10, currency: 'CNY', tags: { c2: '低风险' } },
      { amount: 20, currency: 'CNY', tags: { c1: '活期现金' } },
    ];
    assert.strictEqual(L.runwayLiquidCNY(assets, [{ catId: 'c1', tag: '活期现金' }]), 20);
  });

  test('引用缺 tag（畸形）不得匹配到「没有该分类标签」的资产', () => {
    globalThis.state = freshState();
    const assets = [
      { amount: 100, currency: 'CNY', tags: { c2: '低风险' } },
      { amount: 200, currency: 'CNY', tags: { c1: '活期现金' } },
    ];
    // 畸形引用（有 catId 无 tag）: 若把 undefined 塞进集合, a.tags.c1 也是 undefined,
    // 「没打过这个分类标签」的资产会被误判为命中, 分子虚高
    assert.strictEqual(L.runwayLiquidCNY(assets, [{ catId: 'c1' }]), null, '全部畸形 → 视为未选');
    assert.strictEqual(
      L.runwayLiquidCNY(assets, [{ catId: 'c1', tag: '活期现金' }, { catId: 'c2' }]), 200,
      '畸形项被忽略, 不影响合法项');
  });

  test('所选标签均无有效分类（防御）视为未选，返回 null', () => {
    globalThis.state = freshState();
    assert.strictEqual(L.runwayLiquidCNY([], [{ catId: 1, tag: 'x' }]), null);
  });

  test('未选标签返回 null（UI 据此走指引句，而不是把「没选」显示成 0）', () => {
    assert.strictEqual(L.runwayLiquidCNY([], []), null);
    assert.strictEqual(L.runwayLiquidCNY([], null), null);
  });

  test('选了标签但无资产命中返回 0', () => {
    assert.strictEqual(L.runwayLiquidCNY([], refs), 0);
  });

  test('tags 缺失/损坏的资产与空项不崩', () => {
    const assets = [{ amount: 1, currency: 'CNY' }, { amount: 2, currency: 'CNY', tags: null }, null];
    assert.strictEqual(L.runwayLiquidCNY(assets, refs), 0);
  });

  test('不修改入参', () => {
    const r = [{ catId: 'c1', tag: '活期现金' }];
    L.runwayLiquidCNY([{ amount: 1, currency: 'CNY', tags: { c1: '活期现金' } }], r);
    assert.deepStrictEqual(r, [{ catId: 'c1', tag: '活期现金' }]);
  });
});

describe('runwayMonths / runwayMonthsText（月数口径与展示）', () => {
  test('月数 = 所选标签的钱 ÷ 预期月消费', () => {
    assert.ok(approx(L.runwayMonths(42000, 6000), 7));
    assert.ok(approx(L.runwayMonths(0, 6000), 0));
  });

  test('预期未设 / 分子未选 / 非有限值返回 null', () => {
    assert.strictEqual(L.runwayMonths(42000, 0), null);
    assert.strictEqual(L.runwayMonths(42000, null), null);
    assert.strictEqual(L.runwayMonths(null, 6000), null);
    assert.strictEqual(L.runwayMonths(NaN, 6000), null);
    assert.strictEqual(L.runwayMonths(42000, NaN), null);
  });

  test('展示口径：整数月，小数一律舍弃（保守），不足一个月单独成句', () => {
    assert.strictEqual(L.runwayMonthsText(7), '7 个月');
    assert.strictEqual(L.runwayMonthsText(7.9), '7 个月', '不进位');
    assert.strictEqual(L.runwayMonthsText(11.99), '11 个月', '不会凑成 12 个月');
    assert.strictEqual(L.runwayMonthsText(1), '1 个月');
    assert.strictEqual(L.runwayMonthsText(0.99), '不足 1 个月');
    assert.strictEqual(L.runwayMonthsText(0.4), '不足 1 个月');
    assert.strictEqual(L.runwayMonthsText(0.05), '不足 1 个月');
    assert.strictEqual(L.runwayMonthsText(0), '不足 1 个月');
    assert.strictEqual(L.runwayMonthsText(null), '');
    assert.strictEqual(L.runwayMonthsText(NaN), '');
  });

  test('展示口径：一年以上拆成「x 年 x 月」，月数取整不进位', () => {
    assert.strictEqual(L.runwayMonthsText(12), '1 年');
    assert.strictEqual(L.runwayMonthsText(12.5), '1 年');
    assert.strictEqual(L.runwayMonthsText(15), '1 年 3 个月');
    assert.strictEqual(L.runwayMonthsText(60), '5 年');
    assert.strictEqual(L.runwayMonthsText(100), '8 年 4 个月');
    assert.strictEqual(L.runwayMonthsText(1200), '100 年');
    assert.strictEqual(L.runwayMonthsText(143.6), '11 年 11 个月', '不得进位成 12 年');
    assert.strictEqual(L.runwayMonthsText(23.7), '1 年 11 个月', '不得进位成 2 年');
    assert.strictEqual(L.runwayMonthsText(13.2), '1 年 1 个月');
  });
});

describe('runwayExpectation 迁移兜底（migrateState）', () => {
  test('缺失/损坏归 0，字符串归一为数字，负值归 0（0 = 未自定）', () => {
    globalThis.state = freshState();
    L.migrateState();
    assert.strictEqual(state.runwayExpectation, 0);

    globalThis.state = freshState({ runwayExpectation: '9000' });
    L.migrateState();
    assert.strictEqual(state.runwayExpectation, 9000);

    for (const bad of ['abc', NaN, null, -1]) {
      globalThis.state = freshState({ runwayExpectation: bad });
      L.migrateState();
      assert.strictEqual(state.runwayExpectation, 0, `${String(bad)} 归 0`);
    }
  });

  test('非有限数（JSON 里的 1e999 → Infinity）归 0，不留 Infinity 进存档', () => {
    globalThis.state = freshState({ runwayExpectation: Infinity });
    L.migrateState();
    assert.strictEqual(state.runwayExpectation, 0, 'NaN 会让读数行渲染出 ¥NaN，Infinity 会渲染出 ¥∞');
    assert.strictEqual(JSON.parse(JSON.stringify(state)).runwayExpectation, 0, '存回 JSON 后仍是有限数');
  });
});

describe('runwayTags 迁移兜底（migrateState）', () => {
  test('缺失/损坏归一为 []', () => {
    globalThis.state = freshState({ categories: [{ id: 'c1', name: 'x', tags: ['a'] }] });
    L.migrateState();
    assert.deepStrictEqual(state.runwayTags, []);
    globalThis.state = freshState({ categories: [], runwayTags: 'x' });
    L.migrateState();
    assert.deepStrictEqual(state.runwayTags, []);
  });

  test('指向已删标签/分类的引用在迁移期清理，重复项去掉且保序', () => {
    globalThis.state = freshState({
      categories: [{ id: 'c1', name: 'x', tags: ['a'] }],
      runwayTags: [{ catId: 'c1', tag: 'a' }, { catId: 'c1', tag: 'gone' }, { catId: 'c1', tag: 'a' }],
    });
    L.migrateState();
    assert.deepStrictEqual(state.runwayTags, [{ catId: 'c1', tag: 'a' }]);
  });
});

// ========== 本月预算消耗（趋势页进度读数卡）==========
describe('本月预算 monthExpenseTotal / daysInMonthOf / monthBudgetReading / monthBudgetNote', () => {
  test('monthExpenseTotal 只聚合本月，脏记录贡献 0', () => {
    const expenses = [
      { date: '2026-10-05', amount: 100 },
      { date: '2026-10-31', amount: 23.5 },
      { date: '2026-09-30', amount: 999 },   // 他月不计
      { date: '', amount: 50 },              // 空日期不计
      { amount: 50 },                        // 缺 date 不崩
      { date: '2026-10-02', amount: NaN },   // 脏金额归 0
      { date: '2026-10-02' },                // 缺金额归 0
    ];
    assert.strictEqual(L.monthExpenseTotal(expenses, '2026-10'), 123.5);
    assert.strictEqual(L.monthExpenseTotal(expenses, '2026-09'), 999);
    assert.strictEqual(L.monthExpenseTotal([], '2026-10'), 0);
    assert.strictEqual(L.monthExpenseTotal(null, '2026-10'), 0);
  });

  test('daysInMonthOf 平闰年与非法输入', () => {
    assert.strictEqual(L.daysInMonthOf('2026-01'), 31);
    assert.strictEqual(L.daysInMonthOf('2026-02'), 28);
    assert.strictEqual(L.daysInMonthOf('2024-02'), 29);
    assert.strictEqual(L.daysInMonthOf('2026-04'), 30);
    assert.strictEqual(L.daysInMonthOf(''), null);
    assert.strictEqual(L.daysInMonthOf('2026-13'), null);
    assert.strictEqual(L.daysInMonthOf('2026-00'), null);
    assert.strictEqual(L.daysInMonthOf('abc'), null);
    assert.strictEqual(L.daysInMonthOf(null), null);
  });

  test('monthBudgetReading 口径：剩余 = 预期 − 已花、今天算整天、打平算不超、百分比不封顶', () => {
    // 10 月 31 天, 6 号 → 余 26 天（含今天）
    const t = new Date(2026, 9, 6);
    const r = L.monthBudgetReading(1000, 5000, t);
    assert.strictEqual(r.remaining, 4000);
    assert.strictEqual(r.daysLeft, 26);
    approx(r.dailyLeft, 4000 / 26);
    assert.strictEqual(r.pctOfMonth, 20);
    assert.strictEqual(r.over, false);
    assert.strictEqual(r.excess, 0);

    // 打平不算超（与 incomeGap 打平算盈余同精神）：已花恰好等于预期
    const even = L.monthBudgetReading(5000, 5000, t);
    assert.strictEqual(even.over, false);
    assert.strictEqual(even.remaining, 0);
    assert.strictEqual(even.dailyLeft, 0, '剩余为 0 时日均就是 0, 不显示负数');

    // 超支：剩余为 0（不呈现负数）, 超出额另计, 日均不参与（剩余为 0 即无从谈起）
    const over = L.monthBudgetReading(6000, 5000, t);
    assert.strictEqual(over.over, true);
    assert.strictEqual(over.remaining, 0);
    assert.strictEqual(over.excess, 1000);
    assert.strictEqual(over.dailyLeft, 0);

    // 超过 100% 不封顶（封顶是进度条 UI 职责）
    assert.strictEqual(over.pctOfMonth, 120);

    // 月初 0 元：全月都是剩余
    const first = L.monthBudgetReading(0, 5000, new Date(2026, 9, 1));
    assert.strictEqual(first.daysLeft, 31);
    approx(first.dailyLeft, 5000 / 31);
    assert.strictEqual(first.over, false);

    // 月末最后一天：只余今天一天, 分母不为 0
    const last = L.monthBudgetReading(0, 5000, new Date(2026, 9, 31));
    assert.strictEqual(last.daysLeft, 1);
    assert.strictEqual(last.dailyLeft, 5000);

    // 闰月（2024-02 共 29 天）: 余天数按实际月长算, 不写死 30/31
    const leap = L.monthBudgetReading(0, 5000, new Date(2024, 1, 28));
    assert.strictEqual(leap.daysLeft, 2);

    // 非法 today 兜底为当下（不抛错, 字段仍齐备）
    const fallback = L.monthBudgetReading(100, 5000, 'not-a-date');
    assert.ok(fallback && isFinite(fallback.daysLeft) && fallback.daysLeft >= 1);

    // 未设预期 → null（UI 整卡不显示, 入口交给「预期消费」按钮）
    assert.strictEqual(L.monthBudgetReading(1000, 0, t), null);
    assert.strictEqual(L.monthBudgetReading(1000, -1, t), null);
    assert.strictEqual(L.monthBudgetReading(1000, 'abc', t), null);
  });

  test('monthBudgetNote：剩余/超支两分支单一出口，打平不显示', () => {
    const t = new Date(2026, 9, 6);
    assert.strictEqual(
      L.monthBudgetNote(L.monthBudgetReading(1000, 5000, t)),
      '预算剩 ¥4,000.00 · 余 26 天 · 日均 ¥153.85');
    assert.strictEqual(
      L.monthBudgetNote(L.monthBudgetReading(6000, 5000, t)),
      '已超预算 ¥1,000.00 · 本月额度已用完');
    // 打平 = 预算刚好花完, 没有可叙述的差额
    assert.strictEqual(L.monthBudgetNote(L.monthBudgetReading(5000, 5000, t)), '');
    assert.strictEqual(L.monthBudgetNote(null), '');
    // 脏/缺字段的 reading：不抛错、不打印 ¥NaN，而是不渲染（渲染函数曾只守 remaining,
    // 实际却读 excess/daysLeft/dailyLeft——缺字段会扔 TypeError 而不是兑底）
    assert.strictEqual(L.monthBudgetNote({ over: false, remaining: 100 }), '', '缺 daysLeft/dailyLeft 不炸');
    assert.strictEqual(L.monthBudgetNote({ over: true, remaining: 0 }), '', '缺 excess 不炸');
    assert.strictEqual(L.monthBudgetNote({}), '');
    assert.strictEqual(L.monthBudgetNote({ over: false, remaining: 100, daysLeft: 26, dailyLeft: NaN }), '', 'NaN 不当成数字渲染');
    assert.strictEqual(L.monthBudgetNote({ over: true, remaining: 0, excess: Infinity, daysLeft: 26, dailyLeft: 0 }), '', 'Infinity 同样不渲染');
  });
});

describe('本月预算口径单一来源（monthExpenseTotal 与 monthlyExpenseTotals 同式）', () => {
  test('monthExpenseTotal 与 monthlyExpenseTotals 对同一月份给出相同合计（容错逻辑不得分裂）', () => {
    const expenses = [
      { date: '2026-10-05', amount: 100 },
      { date: '2026-10-31', amount: 23.5 },
      { date: '2026-09-30', amount: 999 },
      { date: '', amount: 50 },
      { date: '2026-10-02', amount: NaN },
    ];
    const fromAggregate = L.monthlyExpenseTotals(expenses).find(x => x.month === '2026-10').total;
    assert.strictEqual(L.monthExpenseTotal(expenses, '2026-10'), fromAggregate);
    // 聚合里不存在的月份（或全部为脏记录）→ 0, 与「找不到即 0」同口径
    assert.strictEqual(L.monthExpenseTotal(expenses, '2026-08'), 0);
    assert.strictEqual(L.monthExpenseTotal(null, '2026-10'), 0);
  });
});

describe('sumAmountCNY（金额合计：分布图总数与报头净资产共用一个口径）', () => {
  const RATES = { CNY: 1, HKD: 0.92, USD: 7.24 };

  test('按各自汇率折算后求和（与 toCNY 同口径，不再二次取倒）', () => {
    const assets = [
      { amount: 100, currency: 'CNY' },
      { amount: 100, currency: 'HKD' },   // 100 × 0.92 = 92
      { amount: 10, currency: 'USD' },    // 10 × 7.24 = 72.4
    ];
    assert.strictEqual(L.sumAmountCNY(assets, RATES), 264.4);
  });

  test('与 toCNY 逐项折算等价（同一口径，不二次取倒）', () => {
    const assets = [
      { id: 'a', amount: 1234.5, currency: 'CNY', tags: {} },
      { id: 'b', amount: 88, currency: 'USD', tags: {} },
      { id: 'c', amount: 250, currency: 'HKD', tags: {} },
    ];
    globalThis.state = { ...freshState(), rates: { ...RATES }, assets };
    // 拿 toCNY（全站唯一的单币种折算口）做参照：逐项折后相加应相等。
    // 不同步复刻 totalAssetsCNY 的公式——那本身就是待防的重复实现；
    // 「report 净资产与这里同源」由 ui-wiring 的接线断言把守。
    const expected = assets.reduce((s, a) => s + L.toCNY(a.amount, a.currency), 0);
    assert.strictEqual(L.sumAmountCNY(assets, RATES), expected);
  });

  test('边界：空数组 / null / 缺失 rates / 非有限金额', () => {
    assert.strictEqual(L.sumAmountCNY([], RATES), 0);
    assert.strictEqual(L.sumAmountCNY(null, RATES), 0);
    assert.strictEqual(L.sumAmountCNY(undefined, undefined), 0);
    // 无 rates 时按 1:1 兜底（与 amountAtRates 一致，不抛错、不出 NaN）
    assert.strictEqual(L.sumAmountCNY([{ amount: 50, currency: 'HKD' }], null), 50);
    // 脏数据（NaN / Infinity / 字符串金额）不污染总数
    const dirty = L.sumAmountCNY([
      { amount: NaN, currency: 'CNY' },
      { amount: Infinity, currency: 'CNY' },
      { amount: '30', currency: 'CNY' },
    ], RATES);
    assert.ok(Number.isFinite(dirty), '总数必须是有限数');
    assert.strictEqual(dirty, 30);
  });

  test('只累加传入的集合（当前筛选范围），不吃全局值', () => {
    const all = [
      { amount: 1000, currency: 'CNY' },
      { amount: 500, currency: 'CNY' },
    ];
    const subset = all.filter(a => a.amount === 500);
    assert.strictEqual(L.sumAmountCNY(all, RATES), 1500);
    assert.strictEqual(L.sumAmountCNY(subset, RATES), 500);
  });
});

describe('行级激活键位 activateKeyAction（可点即键盘可达，单一来源）', () => {
  test('Enter 与 Space 都算激活（role=button 的两种预期键位）', () => {
    assert.strictEqual(L.activateKeyAction('Enter'), true);
    assert.strictEqual(L.activateKeyAction(' '), true);
  });

  test('其余键不激活：Tab 留给焦点移动、Esc 留给关闭、方向键留给滚动', () => {
    for (const k of ['Tab', 'Escape', 'ArrowDown', 'a', '', null, undefined]) {
      assert.strictEqual(L.activateKeyAction(k), false, `${JSON.stringify(k)} 不应激活`);
    }
  });
});

describe('排序表头 aria-sort 口径 sortAriaSort（单一来源）', () => {
  test('当前列按方向给 ascending / descending，其余列 none', () => {
    assert.strictEqual(L.sortAriaSort('amount', 'asc', 'amount'), 'ascending');
    assert.strictEqual(L.sortAriaSort('amount', 'desc', 'amount'), 'descending');
    assert.strictEqual(L.sortAriaSort('amount', 'asc', 'name'), 'none');
    assert.strictEqual(L.sortAriaSort('', 'asc', 'name'), 'none');
  });

  test('脏输入不产出非法值（aria-sort 只认四个字面量）', () => {
    const allowed = ['ascending', 'descending', 'none', 'other'];
    const cases = [[null, null, null], [undefined, 'x', 'a'], ['a', 'sideways', 'a'], ['a', 'asc', null]];
    for (const [by, dir, f] of cases) {
      const got = L.sortAriaSort(by, dir, f);
      assert.ok(allowed.includes(got), `sortAriaSort($by},${dir},${f}) 产出非法值 ${got}`);
    }
  });
});

describe('弹窗焦点陷阱（aria-modal 的兑现）', () => {
  // 15 个弹窗都写了 role="dialog" aria-modal="true"——那是对读屏器的承诺：
  // 弹窗背后的内容不可达。实测却完全没有接管焦点：打开后焦点还在触发按钮上、
  // 第一下 Tab 就走出弹窗、关闭后掉到 body。承诺是空的。
  test('中间的一律交还浏览器：不接管、下标 +1 / -1', () => {
    assert.deepStrictEqual(L.trapFocus(0, 5, false), { wrap: false, index: 1 });
    assert.deepStrictEqual(L.trapFocus(2, 5, false), { wrap: false, index: 3 });
    assert.deepStrictEqual(L.trapFocus(3, 5, true), { wrap: false, index: 2 });
  });

  test('走到两端才接管并绕圈（否则第一下 Tab 就出了弹窗）', () => {
    assert.deepStrictEqual(L.trapFocus(4, 5, false), { wrap: true, index: 0 });
    assert.deepStrictEqual(L.trapFocus(0, 5, true), { wrap: true, index: 4 });
  });

  test('只有一个控件时两个方向都要接管（否则一按 Tab 就掉出去）', () => {
    assert.deepStrictEqual(L.trapFocus(0, 1, false), { wrap: true, index: 0 });
    assert.deepStrictEqual(L.trapFocus(0, 1, true), { wrap: true, index: 0 });
  });

  test('焦点不在弹窗内（-1）时一律拉回来：刚打开，或已经逃逸', () => {
    assert.deepStrictEqual(L.trapFocus(-1, 5, false), { wrap: true, index: 0 });
    assert.deepStrictEqual(L.trapFocus(-1, 5, true), { wrap: true, index: 4 });
  });

  test('没有可聚焦元素时不接管（否则连「关闭」都按不到），且不下标越界', () => {
    assert.deepStrictEqual(L.trapFocus(0, 0, false), { wrap: false, index: -1 });
  });

  test('任何输入下 wrap=true 的 index 必须落在 [0,count) 内', () => {
    for (let count = 0; count <= 6; count++) {
      for (let i = -1; i <= count; i++) {
        for (const shift of [false, true]) {
          const r = L.trapFocus(i, count, shift);
          if (r.wrap) {
            assert.ok(r.index >= 0 && r.index < count, `trapFocus($i},${count},${shift}) 产出越界下标 ${r.index}`);
          }
        }
      }
    }
  });
});

describe('便条的播报优先级', () => {
  // 便条容器原先写死 aria-live="polite"：所有知会（含 22 处 error）都排队等读屏器空闲才念。
  // 但 error 的语义是「出错了、等你处理」——排队到用户下一次操作之后才念，
  // 等于把「现在就得知道」降级成「顺口提一句」。判据下沉到 logic.js（可单测）。
  test('error 用 assertive：出错了要立刻打断朗读，不能排队', () => {
    assert.strictEqual(L.toastLiveMode('error'), 'assertive');
  });

  test('success / info 用 polite：知会性反馈不该打断用户正在听的内容', () => {
    assert.strictEqual(L.toastLiveMode('success'), 'polite');
    assert.strictEqual(L.toastLiveMode('info'), 'polite');
  });

  test('未知 / 缺失类型一律保守取 polite（绝不误用 assertive 去打断）', () => {
    for (const t of [undefined, null, '', 'warn', 'ERROR', 0]) {
      assert.strictEqual(L.toastLiveMode(t), 'polite', `类型 ${String(t)} 应回落 polite`);
    }
  });

  test('只可能产出两个合法值（写进 DOM 属性，写错了浏览器不报错、只是静默失效）', () => {
    const seen = new Set();
    for (const t of ['error', 'success', 'info', 'x', undefined]) seen.add(L.toastLiveMode(t));
    for (const v of seen) assert.ok(['assertive', 'polite'].includes(v), `产出非法值 ${v}`);
  });
});

describe('排序列头对读屏器的表述', () => {
  // 背景：表头是 role="button"（不是 columnheader），而 aria-sort **按规范未定义在 button 上**
  // ——实测 Chrome 的 AX 树里那枚属性不产生任何 sort 信息。真正能被念出来的是**可访问名**，
  // 而当时可访问名里的状态只是一个 ▲/▼ 字形（读屏器念作「上三角」之类），等于没说方向。
  // 故把方向写进可访问名（可测：AX 快照里直接看得到），aria-sort 保留但不再当唯一依赖。
  test('未排序列不带状态后缀（不要给每一列都加噪声）', () => {
    assert.strictEqual(L.sortAriaLabel('金额', '', 'asc', 'amount'), '');
    assert.strictEqual(L.sortAriaLabel('金额', 'name', 'asc', 'amount'), '');
  });

  test('升序 / 降序要念得出来（这是唯一真正到达读屏器的通道）', () => {
    assert.strictEqual(L.sortAriaLabel('金额', 'amount', 'asc', 'amount'), '金额，已按升序排列');
    assert.strictEqual(L.sortAriaLabel('金额', 'amount', 'desc', 'amount'), '金额，已按降序排列');
  });

  test('必须保留可见列名（WCAG「名称包含可见文字」，否则语音控制喊不出这一列）', () => {
    for (const [by, dir] of [['amount', 'asc'], ['amount', 'desc']]) {
      const out = L.sortAriaLabel('金额', by, dir, 'amount');
      assert.ok(out.startsWith('金额'), `可访问名必须以可见列名开头，实际 ${out}`);
    }
  });

  test('方向取值只认 asc/desc，脏值一律当未排序（不误报方向）', () => {
    assert.strictEqual(L.sortAriaLabel('金额', 'amount', 'sideways', 'amount'), '');
    assert.strictEqual(L.sortAriaLabel('金额', 'amount', undefined, 'amount'), '');
  });
});
