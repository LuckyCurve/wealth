/*
 * stress-logic-cases.js —— 压测（stress scenario）单测用例，由 logic.test.js 末尾 require 进来。
 * --------------------------------------------------------------------------
 * 单独成文件只是为了让「压测」这一节可整体阅读；它仍跑在 `node --test` 下，
 * 与 logic.test.js 共享同一份 require('../logic.js')。
 *
 * 用户原话：「对我的资产进行压测，根据分类来，比如分类1下降了 50%，分类2下降了 10%，
 * 我要看看最终表现究竟如何，比如还可以继续多少年的消费，以及消费覆盖率等等，都跟这变」。
 *
 * 四条不变量（为什么这么选见 docs/adr/0004-stress-as-view-overlay.md）：
 *   ① 单维度：一笔钱只被打一次折（每笔资产在每个分类下恰好一个标签，跨维度叠加会让同一笔钱被乘两次）
 *   ② 账本不动：压测只派生读数，state.assets 的 amount 永远是原值（快照/导出/列表/行内编辑都读原值）
 *   ③ 收益同比例缩：利率是收益率不是金额，本金缩了收益必然缩
 *   ④ 未归类按 0% 计入并报出来（静默打折等于替用户编一个假设）
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// 本文件与 logic.test.js 各自可独立运行：被测纯函数读全局 state / incomeMode，
// 这里自行注入（不在两处各写一份断言，但注入是测试脚手架，重复无妨）。
beforeEach(() => {
  globalThis.state = {
    rates: { CNY: 1, HKD: 0.9, USD: 7.2, fetchedAt: null },
    categories: [], assets: [], snapshots: [], expenses: [], expenseCategories: [],
    expenseExpectation: 0, netWorthTarget: 0, incomeSafetyFactor: 100,
    runwayTags: [], runwayExpectation: 0, lang: 'zh', stress: null,
  };
  globalThis.incomeMode = 'max';
});

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('压测：effectiveAssets / stressPctOf（单维度打折，账本不动）', () => {
  const cats = [
    { id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] },
    { id: 'type', name: '资产类型', builtin: false, tags: ['活期现金', '权益基金', '债券基金'] },
    { id: 'risk', name: '风险等级', builtin: false, tags: ['低风险', '高风险'] },
  ];
  const assets = [
    { id: 'a', name: '活期', amount: 100000, currency: 'CNY', tags: { currency: 'CNY', type: '活期现金', risk: '低风险' }, expectedRateMin: 1, expectedRateMax: 2, cashRatio: 100 },
    { id: 'b', name: '指数', amount: 100000, currency: 'CNY', tags: { currency: 'CNY', type: '权益基金', risk: '高风险' }, expectedRateMin: 5, expectedRateMax: 8, cashRatio: 20 },
    { id: 'c', name: '未归类', amount: 100000, currency: 'CNY', tags: { currency: 'CNY' }, expectedRateMin: 0, expectedRateMax: 0, cashRatio: 100 },
  ];

  test('未启用（无情景 / 全 0 / 无维度）时原样返回同一份数组（不复制、不算数）', () => {
    for (const s of [null, undefined, {}, { catId: 'type', drops: [] }, { catId: 'type', drops: [{ tag: '权益基金', pct: 0 }] }]) {
      assert.strictEqual(L.stress.effectiveAssets(assets, s, cats), assets, `${JSON.stringify(s)} 应原样返回`);
    }
  });

  test('命中标签按跌幅打折，未命中的标签与未归类资产不动（未归类按 0%）', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }, { tag: '活期现金', pct: 0 }] };
    const out = L.stress.effectiveAssets(assets, s, cats);
    assert.deepStrictEqual(out.map(a => a.amount), [100000, 50000, 100000]);
  });

  test('不改入参：账本金额必须保持原值（列表/行内编辑/快照/导出都读 state.assets）', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    L.stress.effectiveAssets(assets, s, cats);
    assert.deepStrictEqual(assets.map(a => a.amount), [100000, 100000, 100000], '入参不得被就地改写');
    assert.notStrictEqual(L.stress.effectiveAssets(assets, s, cats), assets, '启用时必须返回新数组');
  });

  test('一笔钱只被打一次折：另一个维度设了跌幅也不叠加（单维度是硬约束）', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    const out = L.stress.effectiveAssets(assets, s, cats);
    assert.strictEqual(out[1].amount, 50000, '只按 type 维度打折，risk 维度不参与');
  });

  test('跌 100% → 金额归零（现有兜底接手，不另写文案）', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 100 }] };
    assert.strictEqual(L.stress.effectiveAssets(assets, s, cats)[1].amount, 0);
  });

  test('其它字段原样带出（利率/现金比例/标签/名称不改：利率是收益率，不随本金缩）', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    const b = L.stress.effectiveAssets(assets, s, cats)[1];
    assert.strictEqual(b.expectedRateMax, 8);
    assert.strictEqual(b.cashRatio, 20);
    assert.deepStrictEqual(b.tags, assets[1].tags);
    assert.strictEqual(b.name, '指数');
  });

  test('收益率口径也随之缩（本金 × 利率在 calcAssetIncome 里自然跟着走）', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    const out = L.stress.effectiveAssets(assets, s, cats);
    const before = L.income.calcAssetIncome(assets[1]);
    const after = L.income.calcAssetIncome(out[1]);
    assert.ok(approx(after.monthly, before.monthly / 2), '月收益减半');
    assert.ok(approx(after.cashMonthly, before.cashMonthly / 2), '现金月收益减半');
  });

  test('容错：非数组 / 空项 / 无 tags / 金额脏值，都不崩也不产出 NaN', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    const out = L.stress.effectiveAssets(
      [null, 'x', {}, { tags: null, amount: 100, currency: 'CNY' }, { tags: { type: '权益基金' }, amount: 'abc', currency: 'CNY' }],
      s, cats);
    assert.strictEqual(out.length, 5);
    assert.strictEqual(out[3].amount, 100, '无 tags 的资产原样保留（未归类 → 0%）');
    assert.strictEqual(out[4].amount, 0, '脏金额归一为 0，不得产出 NaN');
  });

  test('分类列表缺失时按跌幅仍可匹配（分类被删的瞬时态不崩）', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    assert.deepStrictEqual(L.stress.effectiveAssets(assets, s, [])[1].amount, 50000);
  });

  test('stressPctOf 取该维度下该资产的标签跌幅；未命中 / 未归类 / 情景非法 → 0', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }, { tag: '活期现金', pct: 10 }] };
    assert.strictEqual(L.stress.stressPctOf(assets[0], s), 10);
    assert.strictEqual(L.stress.stressPctOf(assets[1], s), 50);
    assert.strictEqual(L.stress.stressPctOf(assets[2], s), 0, '未归类按 0%');
    assert.strictEqual(L.stress.stressPctOf(assets[0], null), 0);
    assert.strictEqual(L.stress.stressPctOf(null, s), 0);
  });
});

describe('压测：stressActive / unclassifiedCNY / weightedDrop', () => {
  const cats = [{ id: 'type', name: '资产类型', builtin: false, tags: ['活期现金', '权益基金'] }];
  const assets = [
    { id: 'a', amount: 100000, currency: 'CNY', tags: { type: '活期现金' } },
    { id: 'b', amount: 100000, currency: 'CNY', tags: { type: '权益基金' } },
    { id: 'c', amount: 50000, currency: 'CNY', tags: {} },
  ];

  test('stressActive：有维度且至少一个非零跌幅才算生效（全 0 = 未启用）', () => {
    assert.strictEqual(L.stress.stressActive(null), false);
    assert.strictEqual(L.stress.stressActive({ catId: 'type', drops: [] }), false);
    assert.strictEqual(L.stress.stressActive({ catId: 'type', drops: [{ tag: 'a', pct: 0 }] }), false);
    assert.strictEqual(L.stress.stressActive({ catId: 'type', drops: [{ tag: 'a', pct: 10 }] }), true);
    assert.strictEqual(L.stress.stressActive({ catId: '', drops: [{ tag: 'a', pct: 10 }] }), false, '没有维度就不成立');
  });

  test('unclassifiedCNY：该维度下未归类（缺 key / 空值 / 指向已删标签）的折算合计与条数', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    const r = L.stress.unclassifiedCNY(assets, s, cats);
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.cny, 50000);
    assert.strictEqual(L.stress.unclassifiedCNY(assets, s, []).count, 0, '分类列表读不到 → 全 0（失败即未知，不假装「全部未归类」；分类真被删时 migrateState 已把情景清成 null）');
    assert.strictEqual(L.stress.unclassifiedCNY(assets, null, cats).count, 0, '未启用 → 0（条上不写口径句）');
    assert.strictEqual(L.stress.unclassifiedCNY(assets, { catId: 'type', drops: [{ tag: '已删', pct: 50 }] }, cats).count, 1, '「未归类」= 该维度没有标签，不是「没填跌幅」（条上每一枚标签都有输入框，默认 0）');
  });

  test('weightedDrop：折算后总额相对原总额的跌幅百分比（报头小字用）', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    assert.ok(approx(L.stress.weightedDrop(assets, s, cats), 20), '原 250000 → 200000 即 20%');
    assert.strictEqual(L.stress.weightedDrop(assets, null, cats), 0);
    assert.strictEqual(L.stress.weightedDrop([], s, cats), 0, '空表不产出 NaN');
    assert.strictEqual(L.stress.weightedDrop([{ amount: 100, currency: 'CNY', tags: {} }], s, cats), 0, '未归类不打折 → 跌幅 0');
  });
});

describe('压测：pruneStress（存档/导入的归一与剪枝）', () => {
  const cats = [
    { id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] },
    { id: 'type', name: '资产类型', builtin: false, tags: ['活期现金', '权益基金'] },
  ];

  test('合法情景原样保留（跌幅归一为 0~100 整数）', () => {
    assert.deepStrictEqual(
      L.stress.pruneStress({ catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] }, cats),
      { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] });
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', drops: [{ tag: '权益基金', pct: '12.6' }] }, cats).drops[0].pct, 13, '四舍五入到整数');
  });

  test('跌幅越界钳制：负数 → 0，>100 → 100，非法 → 丢弃该条', () => {
    const out = L.stress.pruneStress({ catId: 'type', drops: [
      { tag: '权益基金', pct: -10 }, { tag: '活期现金', pct: 150 }, { tag: '权益基金', pct: 'abc' },
    ] }, cats);
    assert.deepStrictEqual(out.drops, [{ tag: '权益基金', pct: 0 }, { tag: '活期现金', pct: 100 }], '非法跌幅丢弃、越界钳制、同标签去重');
  });

  test('指向已删分类/标签、或选了内置货币分类 → 整条作废（不弹提示，静默失效）', () => {
    for (const s of [
      { catId: 'gone', drops: [{ tag: '权益基金', pct: 50 }] },
      { catId: 'currency', drops: [{ tag: 'CNY', pct: 50 }] },
      { catId: 'type', drops: [{ tag: '已删标签', pct: 50 }] },
      { catId: '', drops: [{ tag: '权益基金', pct: 50 }] },
      null, undefined, 'x', 42, [],
    ]) {
      assert.strictEqual(L.stress.pruneStress(s, cats), null, `${JSON.stringify(s)} → null`);
    }
  });

  test('剪完只剩 0 跌幅 → null（全 0 = 未启用，不留空壳在存档里）', () => {
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', drops: [{ tag: '权益基金', pct: 0 }, { tag: '活期现金', pct: 0 }] }, cats), null);
  });

  test('归一：没有 drops / 非数组 / 分类列表非数组都不崩', () => {
    assert.strictEqual(L.stress.pruneStress({ catId: 'type' }, cats), null);
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', drops: 'x' }, cats), null);
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', drops: [{ tag: '权益基金', pct: 30 }] }, null).catId, 'type', '分类列表读不到 ≠ 分类不存在（失败即未知，不得当成已删）');
  });
});

describe('压测：标签改名要迁移情景（不静默失效）', () => {
  test('migrateStressTagRefs 迁移同分类同名的跌幅条目，不改入参', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }, { tag: '活期现金', pct: 10 }] };
    const next = L.stress.migrateStressTagRefs(s, 'type', '权益基金', '股票基金');
    assert.deepStrictEqual(next.drops, [{ tag: '股票基金', pct: 50 }, { tag: '活期现金', pct: 10 }]);
    assert.deepStrictEqual(s.drops, [{ tag: '权益基金', pct: 50 }, { tag: '活期现金', pct: 10 }], '不要就地改入参');
  });

  test('别的分类改名不影响本情景；情景非法/分类不匹配原样返回', () => {
    const s = { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] };
    assert.deepStrictEqual(L.stress.migrateStressTagRefs(s, 'risk', '权益基金', 'X'), s);
    assert.strictEqual(L.stress.migrateStressTagRefs(null, 'type', 'a', 'b'), null);
  });

  test('改名与 pruneStress 的组合：情景不被清掉（改名先于清理的契约）', () => {
    const cats = [{ id: 'type', name: '资产类型', builtin: false, tags: ['股票基金', '活期现金'] }];
    const renamed = L.stress.migrateStressTagRefs({ catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] }, 'type', '权益基金', '股票基金');
    assert.deepStrictEqual(L.stress.pruneStress(renamed, cats), { catId: 'type', drops: [{ tag: '股票基金', pct: 50 }] });
  });
});

describe('压测：展示口径（stressDimensions / stressDropRows / stressBarText）', () => {
  const cats = [
    { id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] },
    { id: 'type', name: '资产类型', builtin: false, tags: ['活期现金', '权益基金'] },
  ];
  const assets = [
    { id: 'a', amount: 100000, currency: 'CNY', tags: { type: '活期现金' } },
    { id: 'b', amount: 100000, currency: 'CNY', tags: { type: '权益基金' } },
    { id: 'c', amount: 50000, currency: 'CNY', tags: {} },
  ];

  test('stressDimensions 排除内置分类（货币类型是另一条真实通道，不参与压测）', () => {
    assert.deepStrictEqual(L.stress.stressDimensions(cats).map(c => c.id), ['type']);
    assert.deepStrictEqual(L.stress.stressDimensions(null), []);
    assert.deepStrictEqual(L.stress.stressDimensions([null, {}, { id: '' }]), [], '非对象 / 无 id 的项不算维度（它进下拉就选不出东西）');
  });

  test('stressDropRows 给出每个标签的折算金额与当前跌幅（口径与分布图同源）', () => {
    const rows = L.stress.stressDropRows(assets, { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] }, cats);
    assert.deepStrictEqual(rows.map(r => r.tag), ['活期现金', '权益基金'], '按分类的标签顺序');
    assert.deepStrictEqual(rows.map(r => r.amount), [100000, 100000]);
    assert.deepStrictEqual(rows.map(r => r.pct), [0, 50]);
    // 外币按当前汇率折算（与分布图的合计同一个 amountAtRates）
    globalThis.state = { ...globalThis.state, rates: { CNY: 1, HKD: 0.9, USD: 7.2 } };
    const rowsFx = L.stress.stressDropRows(
      [{ amount: 100, currency: 'HKD', tags: { type: '活期现金' } }], { catId: 'type', drops: [] }, cats);
    assert.ok(approx(rowsFx[0].amount, 90));
    // 维度不存在 → 空数组（不崩、不产出 NaN）
    assert.deepStrictEqual(L.stress.stressDropRows(assets, { catId: 'gone', drops: [] }, cats), []);
    assert.deepStrictEqual(L.stress.stressDropRows(assets, null, cats), []);
  });

  test('stressBarText 三态：无可用维度 / 未启用 / 生效（含未归类尾巴）', () => {
    globalThis.state = { ...globalThis.state, rates: { CNY: 1, HKD: 0.9, USD: 7.2 } };
    // 只有内置分类 → 邀请去建分类（入口还得留着，否则用户找不到路）
    assert.strictEqual(L.stress.stressBarText(null, [cats[0]], assets), '压测：先在「分类管理」里建一个分类');
    assert.strictEqual(L.stress.stressBarText(null, cats, assets), '压测：未启用');
    const on = L.stress.stressBarText({ catId: 'type', drops: [{ tag: '权益基金', pct: 50 }, { tag: '活期现金', pct: 0 }] }, cats, assets);
    assert.match(on, /压测中：资产类型：权益基金 -50%/);
    assert.match(on, /未归类 ¥50,000\.00 按未打折计入/, '0 跌幅的标签不列出，未归类那句必须出现');
    // 没有未归类资产时不拖那句尾巴
    const noUn = L.stress.stressBarText({ catId: 'type', drops: [{ tag: '权益基金', pct: 50 }] }, cats, assets.slice(0, 2));
    assert.strictEqual(noUn, '压测中：资产类型：权益基金 -50%');
  });
});
