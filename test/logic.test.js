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
