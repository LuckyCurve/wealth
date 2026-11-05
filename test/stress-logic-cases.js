/*
 * stress-logic-cases.js —— 压测（stress scenario）单测用例，由 logic.test.js 末尾 require 进来。
 * --------------------------------------------------------------------------
 * 用户原话：「对我的资产进行压测，根据分类来，比如分类1下降了 50%，分类2下降了 10%，
 * 我要看看最终表现究竟如何，比如还可以继续多少年的消费，以及消费覆盖率等等，都跟这变」。
 * 后来改的交互：滑块是**剩余比例**（默认拉满 100% = 没亏，拉到 66% = 跌 34%）——
 * 用户的心智是「还剩多少」，所以**存的也是 keep**，跌幅只在展示时取补数。
 *
 * 四条不变量（为什么这么选见 DECISIONS.md）：
 *   ① 单维度：一笔钱只被打一次折（每笔资产在每个分类下恰好一个标签，跨维度叠加会让同一笔钱被乘两次）
 *   ② 账本不动：压测只派生读数，state.assets 的 amount 永远是原值（快照/导出/列表/行内编辑都读原值）
 *   ③ 收益同比例缩：利率是收益率不是金额，本金缩了收益必然缩
 *   ④ 未归类按「剩满」计入并报出来（静默打折等于替用户编一个假设）
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

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

describe('压测：effectiveAssets / stressKeepOf（单维度打折，账本不动）', () => {
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

  test('未启用（无情景 / 全是剩满 / 无维度）时原样返回同一份数组（不复制、不算数）', () => {
    for (const s of [null, undefined, {}, { catId: 'type', keeps: [] },
      { catId: 'type', keeps: [{ tag: '权益基金', keep: 100 }] }]) {
      assert.strictEqual(L.stress.effectiveAssets(assets, s), assets, `${JSON.stringify(s)} 应原样返回`);
    }
  });

  test('剩余比例直接乘金额：剩 50% → 腰斩，剩 66% → 打 0.66 折（不是「跌 66%」）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }, { tag: '活期现金', keep: 66 }] };
    const out = L.stress.effectiveAssets(assets, s);
    assert.deepStrictEqual(out.map(a => a.amount), [66000, 50000, 100000]);
  });

  test('没列到的标签按剩满（不打折）；未归类资产同样不动', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    assert.deepStrictEqual(L.stress.effectiveAssets(assets, s).map(a => a.amount), [100000, 50000, 100000]);
  });

  test('不改入参：账本金额必须保持原值（列表/行内编辑/快照/导出都读 state.assets）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    L.stress.effectiveAssets(assets, s);
    assert.deepStrictEqual(assets.map(a => a.amount), [100000, 100000, 100000], '入参不得被就地改写');
    assert.notStrictEqual(L.stress.effectiveAssets(assets, s), assets, '启用时必须返回新数组');
  });

  test('一笔钱只被打一次折：另一个维度设了比例也不叠加（单维度是硬约束）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    assert.strictEqual(L.stress.effectiveAssets(assets, s)[1].amount, 50000, '只按 type 维度打折，risk 维度不参与');
  });

  test('剩 0% → 金额归零（现有兜底接手，不另写文案）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 0 }] };
    assert.strictEqual(L.stress.effectiveAssets(assets, s)[1].amount, 0);
  });

  test('其它字段原样带出（利率/现金比例/标签/名称不改：利率是收益率，不随本金缩）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    const b = L.stress.effectiveAssets(assets, s)[1];
    assert.strictEqual(b.expectedRateMax, 8);
    assert.strictEqual(b.cashRatio, 20);
    assert.deepStrictEqual(b.tags, assets[1].tags);
    assert.strictEqual(b.name, '指数');
  });

  test('收益率口径也随之缩（本金 × 利率在 calcAssetIncome 里自然跟着走）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    const out = L.stress.effectiveAssets(assets, s);
    const before = L.income.calcAssetIncome(assets[1]);
    const after = L.income.calcAssetIncome(out[1]);
    assert.ok(approx(after.monthly, before.monthly / 2), '月收益减半');
    assert.ok(approx(after.cashMonthly, before.cashMonthly / 2), '现金月收益减半');
  });

  test('容错：非数组 / 空项 / 无 tags / 金额脏值，都不崩也不产出 NaN', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    const out = L.stress.effectiveAssets(
      [null, 'x', {}, { tags: null, amount: 100, currency: 'CNY' }, { tags: { type: '权益基金' }, amount: 'abc', currency: 'CNY' }],
      s);
    assert.strictEqual(out.length, 5);
    assert.strictEqual(out[3].amount, 100, '无 tags 的资产原样保留（未归类 → 剩满）');
    assert.strictEqual(out[4].amount, 0, '脏金额归一为 0，不得产出 NaN');
  });

  test('分类列表缺失时按比例仍可匹配（分类被删的瞬时态不崩）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    assert.deepStrictEqual(L.stress.effectiveAssets(assets, s)[1].amount, 50000);
  });

  test('stressKeepOf / stressDropOf：未命中 / 未归类 / 情景非法 → 剩满（跌幅 0）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }, { tag: '活期现金', keep: 90 }] };
    assert.strictEqual(L.stress.stressKeepOf(assets[0], s), 90);
    assert.strictEqual(L.stress.stressKeepOf(assets[1], s), 50);
    assert.strictEqual(L.stress.stressKeepOf(assets[2], s), 100, '未归类按剩满');
    assert.strictEqual(L.stress.stressKeepOf(assets[0], null), 100);
    assert.strictEqual(L.stress.stressKeepOf(null, s), 100);
    // 跌幅是剩余比例的补数，换算是单一来源（页面不得再写 100-keep）
    assert.strictEqual(L.stress.stressDropOf(assets[1], s), 50);
    assert.strictEqual(L.stress.stressDropOf(assets[2], s), 0);
  });
});

describe('压测：stressActive / unclassifiedCNY / weightedDrop', () => {
  const cats = [{ id: 'type', name: '资产类型', builtin: false, tags: ['活期现金', '权益基金'] }];
  const assets = [
    { id: 'a', amount: 100000, currency: 'CNY', tags: { type: '活期现金' } },
    { id: 'b', amount: 100000, currency: 'CNY', tags: { type: '权益基金' } },
    { id: 'c', amount: 50000, currency: 'CNY', tags: {} },
  ];

  test('stressActive：有维度且至少一个标签「不是剩满」才算生效（全剩满 = 未启用）', () => {
    assert.strictEqual(L.stress.stressActive(null), false);
    assert.strictEqual(L.stress.stressActive({ catId: 'type', keeps: [] }), false);
    assert.strictEqual(L.stress.stressActive({ catId: 'type', keeps: [{ tag: 'a', keep: 100 }] }), false);
    assert.strictEqual(L.stress.stressActive({ catId: 'type', keeps: [{ tag: 'a', keep: 99 }] }), true);
    assert.strictEqual(L.stress.stressActive({ catId: '', keeps: [{ tag: 'a', keep: 99 }] }), false, '没有维度就不成立');
  });

  test('unclassifiedCNY：该维度下未归类（缺 key / 空值 / 指向已删标签）的折算合计与条数', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    const r = L.stress.unclassifiedCNY(assets, s, cats);
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.cny, 50000);
    assert.strictEqual(L.stress.unclassifiedCNY(assets, s, []).count, 0, '分类列表读不到 → 全 0（失败即未知）');
    assert.strictEqual(L.stress.unclassifiedCNY(assets, null, cats).count, 0, '未启用 → 0（条上不写口径句）');
  });

  test('weightedDrop：折算后总额相对原总额的跌幅百分比（报头小字用）', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
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

  test('合法情景原样保留（剩余比例归一为 0~100 整数）', () => {
    assert.deepStrictEqual(
      L.stress.pruneStress({ catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] }, cats),
      { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] });
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', keeps: [{ tag: '权益基金', keep: '12.6' }] }, cats).keeps[0].keep, 13, '四舍五入到整数');
  });

  test('剩余比例越界钳制：负数 → 0，>100 → 100，非法 → 丢弃该条', () => {
    const out = L.stress.pruneStress({ catId: 'type', keeps: [
      { tag: '权益基金', keep: -10 }, { tag: '活期现金', keep: 150 }, { tag: '权益基金', keep: 'abc' },
    ] }, cats);
    assert.deepStrictEqual(out.keeps, [{ tag: '权益基金', keep: 0 }, { tag: '活期现金', keep: 100 }], '非法丢弃、越界钳制、同标签去重');
  });

  test('旧格式（跌幅语义的 pct）迁移成剩余：pct 0 = 剩 100%，pct 50 = 剩 50%', () => {
    const out = L.stress.pruneStress({ catId: 'type', drops: [
      { tag: '权益基金', pct: 50 }, { tag: '活期现金', pct: 0 },
    ] }, cats);
    assert.deepStrictEqual(out, { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }, { tag: '活期现金', keep: 100 }] });
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', drops: [{ tag: '权益基金', pct: 0 }] }, cats), null);
  });

  test('指向已删分类/标签、或选了内置货币分类 → 整条作废（不弹提示，静默失效）', () => {
    for (const s of [
      { catId: 'gone', keeps: [{ tag: '权益基金', keep: 50 }] },
      { catId: 'currency', keeps: [{ tag: 'CNY', keep: 50 }] },
      { catId: 'type', keeps: [{ tag: '已删标签', keep: 50 }] },
      { catId: '', keeps: [{ tag: '权益基金', keep: 50 }] },
      null, undefined, 'x', 42, [],
    ]) {
      assert.strictEqual(L.stress.pruneStress(s, cats), null, `${JSON.stringify(s)} → null`);
    }
  });

  test('剪完只剩「剩满」→ null（没亏 = 未启用，不留空壳在存档里）', () => {
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', keeps: [{ tag: '权益基金', keep: 100 }, { tag: '活期现金', keep: 100 }] }, cats), null);
  });

  test('归一：没有 keeps / 非数组 / 分类列表非数组都不崩', () => {
    assert.strictEqual(L.stress.pruneStress({ catId: 'type' }, cats), null);
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', keeps: 'x' }, cats), null);
    assert.strictEqual(L.stress.pruneStress({ catId: 'type', keeps: [{ tag: '权益基金', keep: 70 }] }, null).catId, 'type');
  });
});

describe('压测：标签改名要迁移情景（不静默失效）', () => {
  test('migrateStressTagRefs 迁移同分类同名的比例条目，不改入参', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }, { tag: '活期现金', keep: 90 }] };
    const next = L.stress.migrateStressTagRefs(s, 'type', '权益基金', '股票基金');
    assert.deepStrictEqual(next.keeps, [{ tag: '股票基金', keep: 50 }, { tag: '活期现金', keep: 90 }]);
    assert.deepStrictEqual(s.keeps, [{ tag: '权益基金', keep: 50 }, { tag: '活期现金', keep: 90 }], '不要就地改入参');
  });

  test('别的分类改名不影响本情景；情景非法/分类不匹配原样返回', () => {
    const s = { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] };
    assert.deepStrictEqual(L.stress.migrateStressTagRefs(s, 'risk', '权益基金', 'X'), s);
    assert.strictEqual(L.stress.migrateStressTagRefs(null, 'type', 'a', 'b'), null);
  });

  test('改名与 pruneStress 的组合：情景不被清掉（改名先于清理的契约）', () => {
    const cats = [{ id: 'type', name: '资产类型', builtin: false, tags: ['股票基金', '活期现金'] }];
    const renamed = L.stress.migrateStressTagRefs({ catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] }, 'type', '权益基金', '股票基金');
    assert.deepStrictEqual(L.stress.pruneStress(renamed, cats), { catId: 'type', keeps: [{ tag: '股票基金', keep: 50 }] });
  });
});

describe('压测：展示口径（stressDimensions / stressKeepRows / stressBarText）', () => {
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

  test('stressKeepRows 给出每个标签的折算金额与当前剩余；默认剩满（滑块初始在最右端）', () => {
    const rows = L.stress.stressKeepRows(assets, { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] }, cats);
    assert.deepStrictEqual(rows.map(r => r.tag), ['活期现金', '权益基金'], '按分类的标签顺序');
    assert.deepStrictEqual(rows.map(r => r.amount), [100000, 100000]);
    assert.deepStrictEqual(rows.map(r => r.keep), [100, 50], '没列到的标签默认 100%');
    assert.deepStrictEqual(L.stress.stressKeepRows(assets, { catId: 'type', keeps: [] }, cats).map(r => r.keep), [100, 100]);
    globalThis.state = { ...globalThis.state, rates: { CNY: 1, HKD: 0.9, USD: 7.2 } };
    const rowsFx = L.stress.stressKeepRows(
      [{ amount: 100, currency: 'HKD', tags: { type: '活期现金' } }], { catId: 'type', keeps: [] }, cats);
    assert.ok(approx(rowsFx[0].amount, 90));
    // 维度不存在 → 空数组（不崩、不产出 NaN）
    assert.deepStrictEqual(L.stress.stressKeepRows(assets, { catId: 'gone', keeps: [] }, cats), []);
    assert.deepStrictEqual(L.stress.stressKeepRows(assets, null, cats), []);
  });

  test('stressBarText 三态：无可用维度 / 未启用 / 生效（含未归类尾巴）', () => {
    assert.strictEqual(L.stress.stressBarText(null, [cats[0]], assets), '压测：先在「分类管理」里建一个分类');
    assert.strictEqual(L.stress.stressBarText(null, cats, assets), '压测：未启用');
    const on = L.stress.stressBarText({ catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }, { tag: '活期现金', keep: 100 }] }, cats, assets);
    assert.match(on, /压测中：资产类型：权益基金 50%/);
    assert.match(on, /未归类 ¥50,000\.00 按未打折计入/, '剩满的标签不列出，未归类那句必须出现');
    const noUn = L.stress.stressBarText({ catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] }, cats, assets.slice(0, 2));
    assert.strictEqual(noUn, '压测中：资产类型：权益基金 50%');
  });
});

describe('压测：migrateState 的兜底（旧存档/导入）', () => {
  test('缺失 / 脏值 → null（不落一份畸形情景在 state 里）', () => {
    globalThis.state = {
      ...globalThis.state,
      categories: [{ id: 'type', name: '资产类型', builtin: false, tags: ['权益基金'] }],
      stress: { catId: 'type', keeps: [{ tag: '已删标签', keep: 50 }] },
    };
    L.migrate.migrateState();
    assert.strictEqual(globalThis.state.stress, null);
  });

  test('合法情景经迁移后保留', () => {
    globalThis.state = {
      ...globalThis.state,
      categories: [{ id: 'type', name: '资产类型', builtin: false, tags: ['权益基金'] }],
      stress: { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] },
    };
    L.migrate.migrateState();
    assert.deepStrictEqual(globalThis.state.stress, { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }] });
  });

  test('旧存档（drops/pct 跌幅语义）经迁移转成 keeps：pct 50 → keep 50，pct 0 → keep 100', () => {
    globalThis.state = {
      ...globalThis.state,
      categories: [{ id: 'type', name: '资产类型', builtin: false, tags: ['权益基金', '活期现金'] }],
      stress: { catId: 'type', drops: [{ tag: '权益基金', pct: 50 }, { tag: '活期现金', pct: 0 }] },
    };
    L.migrate.migrateState();
    assert.deepStrictEqual(globalThis.state.stress,
      { catId: 'type', keeps: [{ tag: '权益基金', keep: 50 }, { tag: '活期现金', keep: 100 }] });
  });
});
