/*
 * e2e/app.spec.js — 端到端主用例
 * --------------------------------------------------------------------------
 * 覆盖 UI 契约测试（test/ui-wiring.test.js）够不着的那一层：真实浏览器里的
 * 首屏渲染、导航、增删改、筛选、弹窗、图表初始化、主题切换与 localStorage 持久化。
 *
 * 分组与 AGENTS.md 的模块划分对齐：首屏 / 导航 / 资产 / 消费 / 图表 / 弹窗 / 持久化 / 汇率。
 * 断言落在「用户看得见的东西」与「应用自己的状态」，不断言像素、不断言 CDN。
 */
const {
  test, expect, LS_KEY, INDEX_URL,
  stubCdn, seed, waitReady, disableMotion, readAppState, sampleState,
} = require('./fixtures');

/** 读 localStorage 原文：验证「已落盘」（增删改后应用都会 saveState） */
const readStored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), LS_KEY);

/** 读内存态：验证「迁移/兜底已生效」（migrateState 只修内存态，不回写 localStorage） */
const readState = readAppState;

/** 断言便条文案（#toast-area 是全站唯一出口，可能同时有多条，按文案精确定位） */
const expectToast = (page, msg) =>
  expect(page.locator('#toast-area .toast', { hasText: msg })).toBeVisible();

/**
 * 以自定义存档起页。seed 只在首次导航生效（见 fixtures.seed 的 once 标记），
 * 所以必须在 goto 之前播种：先 goto 再改 localStorage 是无效的。
 * @param {object} opts.rates     覆盖汇率 { hkd, usd }
 * @param {boolean} opts.abortRates 让汇率请求失败（验证 fallback 分支）
 */
async function openWith(page, state, opts = {}) {
  await disableMotion(page);
  await stubCdn(page, opts.rates);
  await seed(page, state);
  // 必须在 goto 之前注册：汇率请求发生在首屏 DOMContentLoaded 里，
  // goto 之后才注册就赶不上，页面会拿到 stubCdn 的成功响应（于是永远走不到 fallback 分支）。
  if (opts.abortRates) await page.route('**/currency-api@latest/**', (route) => route.abort());
  await page.goto(INDEX_URL);
  await waitReady(page);
}

/**
 * 最小存档：只给必填字段，其余由 migrateState() 兜底。
 * 迁移类用例关心的是「缺字段怎么补」，所以基准里刻意不写 cashRatio/rates 等。
 */
const minimalState = (over = {}) => ({
  categories: [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] }],
  assets: [],
  snapshots: [],
  expenseCategories: [],
  expenses: [],
  rates: { CNY: 1, HKD: 1, USD: 1, fetchedAt: null },
  expenseExpectation: 0,
  netWorthTarget: 0,
  incomeSafetyFactor: 100,
  backup: { autoFreq: 'off', lastBackup: null, lastAutoDownload: null },
  ...over,
});

const openSettings = async (page) => {
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('#settings-modal')).toBeVisible();
};

const gotoAssetsTab = async (page, tab = 'assets') => {
  await page.locator('#mode-assets').click();
  if (tab !== 'assets') await page.locator(`#tabs-assets .tab-btn[data-tab="${tab}"]`).click();
};

test.describe('首屏渲染', () => {
  test('全新用户：默认消费模式 + 空态引导', async ({ blankPage: page }) => {
    await expect(page.locator('#mode-expenses')).toHaveClass(/active/);
    await expect(page.locator('#tab-expenses')).toBeVisible();
    await expect(page.locator('#tabs-assets')).toBeHidden();
    await expect(page.locator('#expenses-empty-title')).toHaveText('还没有消费记录');
    // 没有资产 → 净资产为 0，且目标进度不出现（AGENTS.md：总资产为 0 时不显示）
    await expect(page.locator('#masthead-whole')).toHaveText('0');
    await expect(page.locator('#net-worth-target')).toBeHidden();
  });

  test('有数据用户：masthead 按当前汇率折算净资产', async ({ appPage: page }) => {
    // 50000 + 80000 CNY + 50000 HKD ÷ 0.92 = 184347.826…
    await expect(page.locator('#masthead-whole')).toHaveText('184,347');
    await expect(page.locator('#masthead-cents')).toHaveText('.83');
    await expect(page.locator('#masthead-date')).not.toHaveText('—');
  });

  test('启动流程无 JS 报错', async ({ appPage: page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.reload();
    await expect(page.locator('#masthead-whole')).toHaveText('184,347');
    expect(errors).toEqual([]);
  });
});

test.describe('模式与 Tab 导航', () => {
  test('切换顶端模式：资产 ↔ 消费，面板互斥', async ({ appPage: page }) => {
    await page.locator('#mode-assets').click();
    await expect(page.locator('#tabs-assets')).toBeVisible();
    await expect(page.locator('#content-assets')).toBeVisible();
    await expect(page.locator('#tabs-expenses')).toBeHidden();
    await expect(page.locator('#content-expenses')).toBeHidden();

    await page.locator('#mode-expenses').click();
    await expect(page.locator('#tabs-expenses')).toBeVisible();
    await expect(page.locator('#tabs-assets')).toBeHidden();
  });

  test('资产模式五个子 Tab 互斥可见且按钮回显 active', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    for (const [tab, panel] of [
      ['assets', '#tab-assets'],
      ['categories', '#tab-categories'],
      ['chart', '#tab-chart'],
      ['history', '#tab-history'],
      ['income', '#tab-income'],
    ]) {
      await page.locator(`#tabs-assets .tab-btn[data-tab="${tab}"]`).click();
      await expect(page.locator(panel)).toBeVisible();
      await expect(page.locator(`#tabs-assets .tab-btn[data-tab="${tab}"]`)).toHaveClass(/active/);
    }
  });

  test('消费模式四个子 Tab 互斥可见', async ({ appPage: page }) => {
    for (const [tab, panel] of [
      ['expenses', '#tab-expenses'],
      ['expense-categories', '#tab-expense-categories'],
      ['expense-chart', '#tab-expense-chart'],
      ['expense-trend', '#tab-expense-trend'],
    ]) {
      await page.locator(`#tabs-expenses .tab-btn[data-tab="${tab}"]`).click();
      await expect(page.locator(panel)).toBeVisible();
    }
  });

  test('键盘 Tab 在资产/消费间轮流切换（单次按键即生效）', async ({ appPage: page }) => {
    await expect(page.locator('#mode-expenses')).toHaveClass(/active/);
    await page.keyboard.press('Tab');
    await expect(page.locator('#mode-assets')).toHaveClass(/active/);
    await expect(page.locator('#content-assets')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator('#mode-expenses')).toHaveClass(/active/);
  });
});

test.describe('资产增删改', () => {
  test('登记资产：填表 → 列表出现 → 落 localStorage', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    await expect(page.locator('#assets-rows .asset-row')).toHaveCount(3);
    await page.locator('#tab-assets button:has-text("登记资产")').click();
    await expect(page.locator('#asset-modal')).toBeVisible();

    await page.fill('#asset-name', '测试年金');
    await page.fill('#asset-amount', '12,345.67');
    await page.selectOption('#asset-currency', 'USD');
    await page.fill('#asset-rate-min', '2');
    await page.fill('#asset-rate-max', '4');
    // 标签是平铺 chips（见 AGENTS.md），非下拉：点 chip 写入同组 hidden input
    await page.locator('#asset-tags-section .tag-picker').first().locator('.tag-choice', { hasText: '权益基金' }).click();
    await page.locator('#asset-tags-section .tag-picker').nth(1).locator('.tag-choice', { hasText: '低风险' }).click();
    await page.locator('#asset-form button:has-text("保存")').click();

    await expect(page.locator('#asset-modal')).toBeHidden();
    await expect(page.locator('#assets-rows .asset-row')).toHaveCount(4);
    await expect(page.locator('#assets-rows .asset-row', { hasText: '测试年金' })).toContainText('USD');

    const created = (await readStored(page)).assets.find((a) => a.name === '测试年金');
    expect(created.amount).toBe(12345.67);
    expect(created.currency).toBe('USD');
    expect(created.expectedRateMin).toBe(2);
    expect(created.expectedRateMax).toBe(4);
    // 货币标签自动跟随下拉 ⊕ 手选的两个分类标签
    expect(created.tags).toMatchObject({ currency: 'USD', 'cat-type': '权益基金', 'cat-risk': '低风险' });
  });

  test('必选标签缺选：拒绝保存 + 唯一出口的错误便条', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    await page.locator('#tab-assets button:has-text("登记资产")').click();
    await page.fill('#asset-name', '没选标签');
    await page.fill('#asset-amount', '100');
    await page.locator('#asset-form button:has-text("保存")').click();

    await expect(page.locator('#asset-modal')).toBeVisible();
    await expectToast(page, '请为每个分类选择标签');
    expect((await readState(page)).assets).toHaveLength(3);
  });

  test('利率下限高于上限：拒绝保存（0 是合法下限，不被当空值吞掉）', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    await page.locator('#tab-assets button:has-text("登记资产")').click();
    await page.fill('#asset-name', '利率倒挂');
    await page.fill('#asset-amount', '100');
    await page.fill('#asset-rate-min', '5');
    await page.fill('#asset-rate-max', '2');
    await page.locator('#asset-tags-section .tag-picker').first().locator('.tag-choice').first().click();
    await page.locator('#asset-tags-section .tag-picker').nth(1).locator('.tag-choice').first().click();
    await page.locator('#asset-form button:has-text("保存")').click();

    await expectToast(page, '最低利率不能高于最高利率');
    expect((await readState(page)).assets).toHaveLength(3);
  });

  test('编辑资产：改金额后列表与 masthead 同步', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    await page.locator('#assets-rows .asset-row', { hasText: '招商银行活期' }).getByRole('button', { name: '编辑' }).click();
    await expect(page.locator('#asset-modal-title')).toHaveText('编辑资产');
    await page.fill('#asset-amount', '100000');
    await page.locator('#asset-form button:has-text("保存")').click();

    await expect(page.locator('#asset-modal')).toBeHidden();
    await expect(page.locator('#assets-rows .asset-row', { hasText: '招商银行活期' })).toContainText('100,000.00');
    await expect(page.locator('#masthead-whole')).toHaveText('234,347'); // +50000
    expect((await readStored(page)).assets.find((a) => a.id === 'a-cash').amount).toBe(100000);
  });

  test('编辑两位小数利率的资产能正常保存（step 校验不得静默拦截）', async ({ appPage: page }) => {
    // 回归：利率输入框曾用 step="0.1"，0.25% 这类值命中原生 stepMismatch，
    // 浏览器直接拦下 submit —— 点保存毫无反应且无提示。演示数据就是 0.25%/0.35%。
    await gotoAssetsTab(page);
    await page.locator('#assets-rows .asset-row', { hasText: '招商银行活期' }).getByRole('button', { name: '编辑' }).click();
    await expect(page.locator('#asset-rate-min')).toHaveValue('0.25');
    await expect(page.locator('#asset-rate-max')).toHaveValue('0.35');

    await page.fill('#asset-amount', '60000');
    await page.locator('#asset-form button:has-text("保存")').click();

    await expect(page.locator('#asset-modal')).toBeHidden();
    await expectToast(page, '资产已更新');
    expect((await readStored(page)).assets.find((a) => a.id === 'a-cash').amount).toBe(60000);
  });

  test('行内金额编辑：Enter 提交，Esc 不落值', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    const row = page.locator('#assets-rows .asset-row', { hasText: '沪深300指数' });
    await row.locator('.amount-cell').click();
    const input = row.locator('.inline-edit-input');
    await expect(input).toBeVisible();

    await input.fill('90000');
    await input.press('Enter');
    await expect(row.locator('.amount-cell')).toContainText('90,000.00');
    expect((await readStored(page)).assets.find((a) => a.id === 'a-fund').amount).toBe(90000);

    await row.locator('.amount-cell').click();
    await row.locator('.inline-edit-input').fill('1');
    await row.locator('.inline-edit-input').press('Escape');
    await expect(row.locator('.amount-cell')).toContainText('90,000.00');
    expect((await readStored(page)).assets.find((a) => a.id === 'a-fund').amount).toBe(90000);
  });

  test('删除资产：二次确认后消失并落盘', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    await page.locator('#assets-rows .asset-row', { hasText: '汇丰香港储蓄' }).getByRole('button', { name: '删除' }).click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#confirm-msg')).toContainText('确认删除该资产？');
    await page.locator('#confirm-ok-btn').click();

    await expect(page.locator('#assets-rows .asset-row')).toHaveCount(2);
    expect((await readStored(page)).assets.map((a) => a.id)).not.toContain('a-hk');
  });

  test('取消确认框：数据不变', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    await page.locator('#assets-rows .asset-row', { hasText: '汇丰香港储蓄' }).getByRole('button', { name: '删除' }).click();
    await page.locator('#confirm-modal').getByRole('button', { name: '取消' }).click();
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#assets-rows .asset-row')).toHaveCount(3);
  });
});

test.describe('消费记录', () => {
  test('列表默认日期降序（最新在前），合计跟随全量', async ({ appPage: page }) => {
    const rows = page.locator('#expenses-rows .asset-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('2026-02-03');
    await expect(page.locator('#expense-total-line')).toContainText('3 笔');
    await expect(page.locator('#expense-total-line')).toContainText('¥3,330.50');
  });

  test('搜索命中备注并高亮；无结果与无数据是两种空态', async ({ appPage: page }) => {
    await page.fill('#expense-search', '房租');
    await expect(page.locator('#expenses-rows .asset-row')).toHaveCount(1);
    await expect(page.locator('#expenses-rows mark.search-hit')).toHaveCount(1);

    await page.fill('#expense-search', '不存在这个词');
    await expect(page.locator('#expenses-list')).toBeHidden();
    await expect(page.locator('#expenses-empty-title')).toContainText('暂无消费记录');
    await expect(page.locator('#expenses-empty-clear')).toBeVisible();
  });

  test('月份筛选与搜索可叠加，无结果时「清除筛选」回到全量', async ({ appPage: page }) => {
    await page.selectOption('#expense-month-filter', '2026-01');
    await expect(page.locator('#expense-month-filter')).toHaveValue('2026-01');
    await expect(page.locator('#expenses-rows .asset-row')).toHaveCount(2);

    // 叠加搜索：月份内再筛关键词
    await page.fill('#expense-search', '房租');
    await expect(page.locator('#expenses-rows .asset-row')).toHaveCount(1);
    await expect(page.locator('#expense-total-line')).toContainText('2026年1月 匹配');

    // 叠加到无结果 → 空态给出「清除筛选」（有结果时该按钮不出现）
    await page.fill('#expense-search', '咖啡');
    await expect(page.locator('#expenses-empty-clear')).toBeVisible();
    await page.locator('#expenses-empty-clear').click();
    await expect(page.locator('#expenses-rows .asset-row')).toHaveCount(3);
    await expect(page.locator('#expense-search')).toHaveValue('');
    await expect(page.locator('#expense-month-filter')).toHaveValue('');
  });

  test('新增 → 编辑 → 删除完整链路', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    await page.fill('#expense-amount', '66.6');
    await page.fill('#expense-note', '打车');
    await page.locator('#expense-tags-section .tag-picker').first().locator('.tag-choice', { hasText: '微信' }).click();
    await page.locator('#expense-tags-section .tag-picker').nth(1).locator('.tag-choice', { hasText: '餐饮' }).click();
    await page.locator('#expense-form button:has-text("保存")').click();

    await expect(page.locator('#expense-modal')).toBeHidden();
    await expect(page.locator('#expenses-rows .asset-row')).toHaveCount(4);
    const row = page.locator('#expenses-rows .asset-row', { hasText: '打车' });
    await expect(row).toContainText('66.60');

    await row.getByRole('button', { name: '编辑' }).click();
    await expect(page.locator('#expense-modal-title')).toHaveText('编辑消费');
    await page.fill('#expense-note', '打车（改）');
    await page.locator('#expense-form button:has-text("保存")').click();
    await expect(page.locator('#expenses-rows')).toContainText('打车（改）');

    await page.locator('#expenses-rows .asset-row', { hasText: '打车（改）' }).getByRole('button', { name: '删除' }).click();
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#expenses-rows .asset-row')).toHaveCount(3);
    expect((await readStored(page)).expenses).toHaveLength(3);
  });

  test('复制消费：预填金额/备注/标签，日期落到今天，新增而非覆盖', async ({ appPage: page }) => {
    await page.locator('#expenses-rows .asset-row', { hasText: '房租' }).getByRole('button', { name: '复制' }).click();
    await expect(page.locator('#expense-modal-title')).toHaveText('复制消费');
    await expect(page.locator('#expense-amount')).toHaveValue('3,200');
    await expect(page.locator('#expense-note')).toHaveValue('房租');
    const today = await page.evaluate(() => document.getElementById('expense-date').value);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.locator('#expense-form button:has-text("保存")').click();
    await expect(page.locator('#expenses-rows .asset-row')).toHaveCount(4);
    expect((await readStored(page)).expenses.filter((e) => e.note === '房租')).toHaveLength(2);
  });

  test('金额为 0：拒绝保存且停留在弹窗', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await page.fill('#expense-amount', '0');
    await page.locator('#expense-form button:has-text("保存")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    await expectToast(page, '金额必须大于 0');
    expect((await readState(page)).expenses).toHaveLength(3);
  });

  test('三态排序：粘性翻转 → 循环 → 取消', async ({ appPage: page }) => {
    const dates = () => page.locator('#expenses-rows .asset-row > div:first-child').allInnerTexts();
    await expect(await dates()).toEqual(['2026-02-03', '2026-01-20', '2026-01-05']);

    await page.locator('[onclick="toggleExpenseSort(\'date\')"]').click(); // 首次点击：粘性翻转
    await expect(await dates()).toEqual(['2026-01-05', '2026-01-20', '2026-02-03']);
    await expect(page.locator('#expense-sort-date')).toContainText('▲');

    await page.locator('[onclick="toggleExpenseSort(\'date\')"]').click(); // 进入三态循环
    await expect(page.locator('#expense-sort-date')).toContainText('▼');
    await expect(await dates()).toEqual(['2026-02-03', '2026-01-20', '2026-01-05']);

    await page.locator('[onclick="toggleExpenseSort(\'date\')"]').click(); // 第三次：取消排序
    await expect(page.locator('#expense-sort-date')).toBeEmpty();
  });
});

test.describe('图表初始化与空态', () => {
  test('资产分布：echarts 在对应容器上初始化', async ({ appPage: page }) => {
    await gotoAssetsTab(page, 'chart');
    await expect(page.locator('#sunburst-chart')).toBeVisible();
    await expect(page.locator('#chart-empty')).toBeHidden();
    // switchTab 里是 setTimeout(100) 后才 renderChart，init 晚于容器可见
    await expect
      .poll(() => page.evaluate(() => window.__echartsCalls.init))
      .toContain('sunburst-chart');
    await expect
      .poll(() => page.evaluate(() => window.__echartsCalls.setOption.length))
      .toBeGreaterThan(0);
  });

  test('旭日图空态：所选维度无数据时不留空白画布', async ({ page }) => {
    const s = sampleState();
    // 新增一个没有任何资产归类的维度：选中它应显示空态而非空白画布
    s.categories.push({ id: 'cat-empty', name: '空维度', builtin: false, tags: ['甲', '乙'] });
    await openWith(page, s);
    await gotoAssetsTab(page, 'chart');
    await page.selectOption('#chart-category-select', 'cat-empty');
    await expect(page.locator('#chart-empty')).toBeVisible();
    await expect(page.locator('#sunburst-chart')).toBeHidden();
  });

  test('消费趋势：已设预期月消费时读数卡出现并显示参考线数值', async ({ appPage: page }) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await expect(page.locator('#expense-trend-chart')).toBeVisible();
    await expect(page.locator('#month-pace-card')).toBeVisible();
    await expect(page.locator('#pace-expense')).toHaveText('¥5,000.00');
  });

  test('消费趋势：未设预期月消费时读数卡全部隐藏', async ({ blankPage: page }) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await expect(page.locator('#expense-trend-empty')).toBeVisible();
    await expect(page.locator('#month-pace-card')).toBeHidden();
    await expect(page.locator('#runway-card')).toBeHidden();
  });
});

test.describe('读数卡的自定月消费（只对本卡生效）', () => {
  const openRunway = async (page) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await page.locator('#runway-guide button').click();
    await expect(page.locator('#runway-modal')).toBeVisible();
  };

  test('默认带出已填的预期月消费；改后只影响本卡，全局预期与存档不被回写', async ({ appPage: page }) => {
    await openRunway(page);
    // 未自定时分母就是全局「预期月消费」，输入框默认值须是它（不用重敲）
    await expect(page.locator('#runway-expectation')).toHaveValue('5,000');
    await expect(page.locator('#runway-preview')).toHaveText('勾选标签后这里显示结果');

    await page.locator('#runway-tag-groups .tag-choice', { hasText: '活期现金' }).first().click();
    await expect(page.locator('#runway-preview')).toContainText('¥5,000.00');

    await page.locator('#runway-expectation').fill('9000');
    await expect(page.locator('#runway-preview')).toContainText('¥9,000.00');
    await page.locator('#runway-modal .btn-gold').click();
    await expect(page.locator('#runway-modal')).toBeHidden();

    // 读数卡换用自定分母（并标出自定），消费趋势的参考线/进度卡仍是全局值
    await expect(page.locator('#runway-expense-name')).toHaveText('月消费（自定）');
    await expect(page.locator('#runway-expense')).toHaveText('¥9,000.00');
    await expect(page.locator('#pace-expense')).toHaveText('¥5,000.00');

    const stored = await readStored(page);
    expect(stored.runwayExpectation).toBe(9000);
    expect(stored.expenseExpectation).toBe(5000); // 自定值不得回填全局预期月消费
  });

  test('自定值持久化（刷新后仍在），清空则回落全局预期', async ({ appPage: page }) => {
    await openRunway(page);
    await page.locator('#runway-tag-groups .tag-choice', { hasText: '活期现金' }).first().click();
    await page.locator('#runway-expectation').fill('2000');
    await page.locator('#runway-modal .btn-gold').click();
    await expect(page.locator('#runway-expense')).toHaveText('¥2,000.00');

    await page.reload();
    await waitReady(page);
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await expect(page.locator('#runway-expense')).toHaveText('¥2,000.00');

    // 清空回默认（不是回 0）：把全局预期填回字段, 保存后分母名不再标「自定」
    await page.locator('#runway-reading button').click();
    await page.locator('#runway-expectation').fill('');
    await page.locator('#runway-modal .btn-gold').click();
    await expect(page.locator('#runway-expense-name')).toHaveText('预期月消费');
    await expect(page.locator('#runway-expense')).toHaveText('¥5,000.00');
    expect((await readStored(page)).runwayExpectation).toBe(0);

    // 重开后默认带出当前生效的分母（就是全局预期），不必重敲
    await page.locator('#runway-reading button').click();
    await expect(page.locator('#runway-expectation')).toHaveValue('5,000');

    // 「默认」按钮把全局预期填回字段
    await page.locator('#runway-expectation').fill('9000');
    await page.locator('[onclick="useDefaultRunwayExpectation()"]').click();
    await expect(page.locator('#runway-expectation')).toHaveValue('5,000');

    // 填成与全局预期相同的数 → 按默认存（不标「自定」, 不钉住旧值）
    await page.locator('#runway-expectation').fill('5000');
    await page.locator('#runway-modal .btn-gold').click();
    await expect(page.locator('#runway-expense-name')).toHaveText('预期月消费');
    expect((await readStored(page)).runwayExpectation).toBe(0);
  });
});

test.describe('弹窗与提示', () => {
  test('ESC 关闭最上层弹窗', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#expense-modal')).toBeHidden();
  });

  test('确认框走 ESC：取消而非执行回调', async ({ appPage: page }) => {
    await gotoAssetsTab(page);
    await page.locator('#assets-rows .asset-row', { hasText: '汇丰香港储蓄' }).getByRole('button', { name: '删除' }).click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#assets-rows .asset-row')).toHaveCount(3);
  });

  test('提示便条是唯一出口且会自动退场', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await page.fill('#expense-amount', '0');
    await page.locator('#expense-form button:has-text("保存")').click();
    await expect(page.locator('#toast-area .toast', { hasText: '金额必须大于 0' })).toBeVisible();
    await expect(page.locator('#toast-area .toast', { hasText: '金额必须大于 0' })).toBeHidden({ timeout: 10000 });
  });

  test('设置弹窗是主题切换的唯一入口', async ({ appPage: page }) => {
    await openSettings(page);
    await page.locator('#theme-seg-dark').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('#theme-seg-dark')).toHaveClass(/active/);

    await page.locator('#theme-seg-light').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('#theme-seg-light')).toHaveClass(/active/);
    expect(await page.evaluate(() => localStorage.getItem('dark-mode'))).toBe('');
  });

  test('删除分类同步清理资产上的标签引用（不留孤儿 key）', async ({ appPage: page }) => {
    await gotoAssetsTab(page, 'categories');
    await page.locator('#categories-list .card', { hasText: '资产类型' }).getByRole('button', { name: '删除' }).click();
    await page.locator('#confirm-ok-btn').click();

    await expect(page.locator('#categories-list .card', { hasText: '资产类型' })).toHaveCount(0);
    const st = await readStored(page);
    expect(st.categories.map((c) => c.id)).not.toContain('cat-type');
    st.assets.forEach((a) => expect(Object.keys(a.tags)).not.toContain('cat-type'));
  });
});

test.describe('持久化与迁移', () => {
  test('刷新后数据不变（localStorage 存档落地）', async ({ appPage: page }) => {
    // 关键：断言的是「改动过的存档」在刷新后仍在。
    // 若只看种子值 3 条，则 seed 每轮重新播种时该用例永远绿（假通过）——
    // 它验证的是种子被重写，而不是应用真的读了存档。故此处先落一条改动。
    await gotoAssetsTab(page);
    await expect(page.locator('#assets-rows .asset-row')).toHaveCount(3);
    await page.evaluate(() => {
      state.assets = state.assets.slice(0, 1);
      saveState();
    });
    expect((await readStored(page)).assets).toHaveLength(1);

    await page.reload();
    await waitReady(page);
    await gotoAssetsTab(page);
    await expect(page.locator('#assets-rows .asset-row')).toHaveCount(1);
    expect((await readStored(page)).assets).toHaveLength(1);
  });

  test('刷新不会把存档重置回种子值（seed 只作用于首次导航）', async ({ appPage: page }) => {
    // 把上面那条用例的护栏单独钉住：seed 若忘了加 once 标记，reload 会重新播种，
    // 这条会先红，避免「持久化用例假通过」再次悄悄发生
    await gotoAssetsTab(page);
    await page.evaluate(() => { state.assets = []; saveState(); });
    await page.reload();
    await waitReady(page);
    expect(await page.evaluate(() => state.assets.length)).toBe(0);
  });

  test('损坏的存档回退到初始状态，不白屏', async ({ page }) => {
    await disableMotion(page);
    await stubCdn(page);
    await page.addInitScript((key) => localStorage.setItem(key, '{不是合法 JSON'), LS_KEY);
    await page.goto('index.html');
    await waitReady(page);
    await expect(page.locator('#masthead-whole')).toHaveText('0');
    // 内置货币分类由 migrateState 补回
    expect((await readState(page)).categories.map((c) => c.id)).toContain('currency');
  });

  test('旧版单值 expectedRate 迁移为 Min/Max', async ({ page }) => {
    await openWith(page, minimalState({
      assets: [{ id: 'old', name: '旧格式资产', amount: 1000, currency: 'CNY', tags: { currency: 'CNY' }, expectedRate: 3.5 }],
    }));

    const asset = (await readState(page)).assets.find((a) => a.id === 'old');
    expect(asset.expectedRateMin).toBe(3.5);
    expect(asset.expectedRateMax).toBe(3.5);
    expect(asset.expectedRate).toBeUndefined();
  });

  test('缺失 cashRatio 的旧资产默认 100（全额现金）', async ({ page }) => {
    await openWith(page, minimalState({
      assets: [{ id: 'no-cash', name: '缺现金比例', amount: 1000, currency: 'CNY', tags: { currency: 'CNY' } }],
    }));
    expect((await readState(page)).assets.find((a) => a.id === 'no-cash').cashRatio).toBe(100);
  });

  test('孤儿标签引用在迁移期被清理', async ({ page }) => {
    await openWith(page, minimalState({
      expenseCategories: [{ id: 'ec-pay', name: '支付方式', builtin: false, tags: ['微信'] }],
      // ec-gone 分类已不存在 → 其标签引用应在迁移时剔除
      expenses: [{ id: 'e-1', date: '2026-01-05', amount: 10, note: 'x', tags: { 'ec-pay': '微信', 'ec-gone': '幽灵' } }],
    }));
    expect(Object.keys((await readState(page)).expenses[0].tags)).toEqual(['ec-pay']);
  });
});

test.describe('覆盖标尺的缺口 Tips（还需本金）', () => {
  // 有息本金 13 万（50000+80000 CNY, HKD 折算另计）、max 档年化约 6.58%
  const gotoIncome = async (page) => {
    await gotoAssetsTab(page, 'income');
    await expect(page.locator('#cov-section')).toBeVisible();
  };

  test('缺口时出现 ? Tips，气泡给出按实际年化线性外推的还需本金', async ({ appPage: page }) => {
    await gotoIncome(page);
    const tip = page.locator('#cov-reading .tip');
    await expect(tip).toBeVisible();
    await tip.locator('.tip-mark').hover();
    const bubble = page.locator('#cov-shortfall-tip');
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText('线性外推');
    await expect(bubble).toContainText('还需本金');
  });

  test('切到现金口径：Tips 跟随当前分子重算（同一气泡、数字随口径变化）', async ({ appPage: page }) => {
    await gotoIncome(page);
    await page.locator('#cov-reading .tip-mark').hover();
    const bubble = page.locator('#cov-shortfall-tip');
    await expect(bubble).toBeVisible();
    const totalText = await bubble.textContent();

    await page.locator('#cov-mode-cash').click();
    await expect(page.locator('#cov-mode-cash')).toHaveClass(/active/);
    // 重绘后气泡回到收起态（须重新 hover），口径切换后 ? 图标仍在
    await expect(page.locator('#cov-reading .tip-mark')).toBeVisible();
    await page.locator('#cov-reading .tip-mark').hover();
    await expect(bubble).toContainText('还需本金');
    expect(await bubble.textContent()).not.toBe(totalText);
  });

  test('安全边际滑块拖动：Tips 随折算后的年化同步变化', async ({ appPage: page }) => {
    await gotoIncome(page);
    await page.locator('#cov-reading .tip-mark').hover();
    const bubble = page.locator('#cov-shortfall-tip');
    await expect(bubble).toBeVisible();
    const before = await bubble.textContent();

    await page.locator('#income-safety-input').fill('50');
    await expect(page.locator('#income-safety-readout')).toHaveText('50%');
    await page.locator('#cov-reading .tip-mark').hover();
    await expect(bubble).toContainText('线性外推');
    expect(await bubble.textContent()).not.toBe(before);
  });

  test('已覆盖时不挂 Tips（达标只剩印徽）', async ({ page }) => {
    const s = sampleState();
    s.expenseExpectation = 10; // 远低于月收益 → 覆盖
    await openWith(page, s);
    await gotoIncome(page);
    await expect(page.locator('#cov-reading .mo-badge.up')).toBeVisible();
    await expect(page.locator('#cov-reading .tip')).toHaveCount(0);
  });
});

test.describe('汇率', () => {
  test('汇率口径：1 外币 = X CNY，页面对 API 的倒数取值不重复取倒', async ({ page }) => {
    // API 给 1 CNY = 0.5 HKD → HKD→CNY = 2 → 50000 HKD = 100000 CNY
    await openWith(page, sampleState(), { rates: { hkd: 0.5, usd: 7.24 } });
    await expect(page.locator('#masthead-whole')).toHaveText('230,000');
    expect(await page.evaluate(() => state.rates.HKD)).toBe(2);
  });

  test('拉取成功：写入「1 外币 = X CNY」口径并刷新折算', async ({ appPage: page }) => {
    // API 给 1 CNY = 0.92 HKD，应用应存 1/0.92（1 HKD = X CNY），不得重复取倒
    await expectToast(page, '汇率已更新');
    expect(await page.evaluate(() => state.rates.HKD)).toBeCloseTo(1 / 0.92, 6);
    await expect(page.locator('#masthead-whole')).toHaveText('184,347');
  });

  test('拉取失败且有缓存汇率：沿用缓存、提示中性、数值不跳变', async ({ page }) => {
    // 补上 rateFallbackNotice(hasCache=true) 这一支：此前只有「无缓存」分支被覆盖，
    // 「有缓存」分支（文案「使用缓存汇率」）没有任何用例走到
    const s = sampleState();
    // 缓存汇率必须是**应用口径**（1 HKD = 1/0.92 CNY），且 fetchedAt 非空才算「有缓存」
    s.rates = { CNY: 1, HKD: 1 / 0.92, USD: 1 / 7.24, fetchedAt: '2026-01-01T00:00:00.000Z' };
    await openWith(page, s, { abortRates: true });

    await expectToast(page, '使用缓存汇率');
    await expect(page.locator('#masthead-whole')).toHaveText('184,347');
  });

  test('首次启动且拉不到汇率：报「汇率获取失败」但仍可用（按 1:1 兜底）', async ({ page }) => {
    const s = sampleState();
    s.rates = { CNY: 1, HKD: 1, USD: 1, fetchedAt: null }; // 从未成功拉过
    await openWith(page, s, { abortRates: true });

    await expectToast(page, '汇率获取失败');
    await expect(page.locator('#masthead-whole')).toHaveText('180,000'); // HKD 按 1:1
  });
});
