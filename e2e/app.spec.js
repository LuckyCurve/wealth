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
  stubCdn, seed, waitReady, disableMotion, readAppState, sampleState, gotoAssets,
} = require('./fixtures');
// 长按守卫窗阈值：E2E 等它过期时轮询真实常量，不复制一个数字（复制必然漂移）
const { AUTO_OPEN_GUARD_MS, TAG_PRESS_MS } = require('../logic.js');

/** 按住不放：用页面自己的时钟等到「真的按满 TAG_PRESS_MS」，不猜一个睡眠时长 */
const holdPastTagPress = async (page) => {
  await page.evaluate(() => { window.__holdStart = performance.now(); });
  return expect
    .poll(() => page.evaluate(() => performance.now() - window.__holdStart), { message: `应已按住 ${TAG_PRESS_MS}ms` })
    .toBeGreaterThan(TAG_PRESS_MS);
};

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

const gotoAssetsTab = (page, tab) => gotoAssets(page, tab === 'assets' ? undefined : tab);

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
    await gotoAssets(page);
    await expect(page.locator('#content-assets')).toBeVisible();
    await expect(page.locator('#tabs-expenses')).toBeHidden();
    await expect(page.locator('#content-expenses')).toBeHidden();

    await page.locator('#mode-expenses').click();
    await expect(page.locator('#tabs-expenses')).toBeVisible();
    await expect(page.locator('#tabs-assets')).toBeHidden();
  });

  test('已在资产页时入口失效：不再弹「现在确实要看？」（键盘通直也被挡）', async ({ appPage: page }) => {
    await gotoAssets(page);
    // 按完整条链路（真实鼠标长按）也不应该再弹一次
    const box = await page.locator('#mode-assets').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.locator('#mode-assets').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#content-assets')).toBeVisible();
  });

  test('确认框的按钮文案随调用重置（金调的「查看资产」不粘到删除确认上）', async ({ appPage: page }) => {
    // 先用长按链路把确认框染成金色，再用同框做一次删除确认
    await page.locator('#mode-assets').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#confirm-ok-btn')).toHaveText('查看资产');
    await page.locator('#confirm-modal button:has-text("取消")').click();

    await gotoAssets(page);
    await page.locator('#assets-rows .asset-row').first().getByRole('button', { name: '删除' }).click();
    await expect(page.locator('#confirm-ok-btn')).toHaveText('确认');
    await expect(page.locator('#confirm-ok-btn')).toHaveClass(/btn-danger/);
  });

  test('触摸轻点不进门（手机上顺手一摸不该放行；detail 的取值靠真实触摸钉住）', async ({ browser }) => {
    // 新建一个带触摸的上下文：默认 fixture 是桌面设备，触摸路径得亲自跑一遍。
    // 新上下文里的 page 不经 fixture 的 stubCdn——stub 只挂在 fixture 自己那个 page 上，
    // 必须自己补一份，否则这个用例会静默连真实外网（本机联网才绿，断网/弱网会卡在 CDN 请求上）。
    const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 800 }, isMobile: true });
    const touch = await ctx.newPage();
    await stubCdn(touch);
    await touch.goto(INDEX_URL);
    await waitReady(touch);
    // 探针：__echartsCalls 只有 stubCdn 的占位脚本才会定义（真 CDN 不定义它）。
    // 它存在 = 这个上下文确实走了替身路由——这就是「不再真连外网」的证据。
    expect(await touch.evaluate(() => !!window.__echartsCalls), '触摸上下文也必须走 CDN 替身').toBe(true);
    await touch.locator('#mode-assets').tap();
    await expect(touch.locator('#content-assets')).toBeHidden();
    await expect(touch.locator('#confirm-modal')).toBeHidden();
    await expect(touch.locator('#toast-area .toast', { hasText: '长按' })).toBeVisible();
    // 键盘仍然可达（辅助技术不被挡在门外）
    await touch.locator('#mode-assets').focus();
    await touch.keyboard.press('Enter');
    await expect(touch.locator('#confirm-modal')).toBeVisible();
    await ctx.close();
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

  test('资产入口是长按门槛：短按不进门只给提示，按满再确认才进', async ({ appPage: page }) => {
    const assets = page.locator('#mode-assets');
    // 短按：不进门，只给一句「长按多久」
    await assets.click();
    await expect(page.locator('#content-assets')).toBeHidden();
    await expect(page.locator('#toast-area .toast', { hasText: '长按' })).toBeVisible();

    // 长按：按住期间墨线浸满（--mode-press 由 rAF 推进），**按满即弹**（不必等松手）
    const box = await assets.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(assets).toHaveClass(/pressing/);
    await expect
      .poll(() => assets.evaluate((el) => parseFloat(el.style.getPropertyValue('--mode-press'))))
      .toBeGreaterThan(0.2);

    // 按满的瞬间确认框自己出现（手指还按着）——这就是「自动弹窗」的观感
    await expect(page.locator('#confirm-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#confirm-title')).toHaveText('进入资产页');
    await expect(page.locator('#confirm-ok-btn')).toHaveText('查看资产');
    await expect(page.locator('#content-assets')).toBeHidden();

    // 抬起的手指紧跟一次 mouse.up —— 守卫窗内不得把确认框点掉/取消
    await page.mouse.up();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#content-assets')).toBeHidden();

    // 守卫窗后再点确认，正常进门：轮询到守卫过期（阈值取 logic.js 常量——固定 sleep 要么白等要么不够）
    await expect
      .poll(() => page.evaluate(() => (__autoOpenedAt === null ? -1 : performance.now() - __autoOpenedAt)),
        { message: '等长按守卫窗过期' })
      .toBeGreaterThan(AUTO_OPEN_GUARD_MS);
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#content-assets')).toBeVisible();
    await expect(page.locator('#mode-assets')).toHaveClass(/active/);
    await expect(page.locator('#mode-assets')).not.toHaveClass(/pressing|armed/);
  });

  test('长按中途取消：指针移开即放弃，不留满格墨线', async ({ appPage: page }) => {
    const assets = page.locator('#mode-assets');
    const box = await assets.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(assets).toHaveClass(/pressing/);
    await page.mouse.move(box.x + box.width / 2, box.y + 200); // 拖出按钮
    await page.mouse.up();
    await expect(assets).not.toHaveClass(/pressing/);
    await expect(page.locator('#content-assets')).toBeHidden();
    await expect(page.locator('#confirm-modal')).toBeHidden();
  });

  test('取消确认框：留在消费页', async ({ appPage: page }) => {
    await page.locator('#mode-assets').click(); // 短按只提示，不弹确认
    await expect(page.locator('#content-assets')).toBeHidden();
    // 键盘激活（detail === 0）直通确认框：不用鼠标的人不该被长按挡在门外
    await page.locator('#mode-assets').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.locator('#confirm-modal button:has-text("取消")').click();
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#content-expenses')).toBeVisible();
    await expect(page.locator('#content-assets')).toBeHidden();
  });

  test('键盘 Tab 不再在资产/消费间切换（交还浏览器默认焦点顺序）', async ({ appPage: page }) => {
    await expect(page.locator('#mode-expenses')).toHaveClass(/active/);
    await page.keyboard.press('Tab');
    // 只断言「Tab 走了普通焦点、没有切换模式」，**不写死第一个焦点是谁**：
    // 顶端按钮的左右次序是设计决定（消费在左），把它钉在 E2E 里会让一次换位连带改测试；
    // 次序本身由 ui-wiring 的契约测试守（那条才是「有意为之」的载体）
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(['mode-expenses', 'mode-assets']).toContain(focused);
    await expect(page.locator('#content-expenses')).toBeVisible();
    await expect(page.locator('#content-assets')).toBeHidden();
    await expect(page.locator('#mode-expenses')).toHaveClass(/active/, { timeout: 1000 });
  });
});

test.describe('已经在某一页上时再点它：空点击', () => {
  // 用户实测：「已经在消费分布这个标签下，再次点击它应该不生效，现在还会重新刷新页面」。
  // 重绘 + 重播入场只是把同样的东西再画一遍，用户看到的是一次没有理由的闪动。
  const paneX = (page, sel) =>
    page.evaluate((s) => (document.querySelector(s).style.getPropertyValue('--pane-x') || '').trim(), sel);
  const renders = (page, id) =>
    page.evaluate((i) => window.__echartsCalls.setOption.filter((c) => c.id === i).length, id);

  test('点当前已激活的 Tab：图不重画、入场方向不被改写', async ({ appPage: page }) => {
    const tab = page.locator('#tabs-expenses .tab-btn[data-tab="expense-chart"]');
    await tab.click();
    await expect(page.locator('#expense-sunburst-chart')).toBeVisible();
    await expect
      .poll(() => renders(page, 'expense-sunburst-chart'), { message: '进入消费分布应完成一次图表渲染' })
      .toBeGreaterThan(0);
    const before = await renders(page, 'expense-sunburst-chart');
    const x1 = await paneX(page, '#tab-expense-chart');

    await tab.click(); // 再点一次「当前」这个 Tab

    // 换到消费趋势并等它的渲染落地：这证明时间真的往前走过（异步渲染那一档已经烧完）。
    // 若刚才那次点击排了定时器，它必然先于这一步执行——同延时的定时器先排先烧。
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await expect
      .poll(() => renders(page, 'expense-trend-chart'), { message: '消费趋势应完成一次图表渲染' })
      .toBeGreaterThan(0);

    expect(await renders(page, 'expense-sunburst-chart'), '再点当前 Tab 不该重绘消费分布的图').toBe(before);
    expect(await paneX(page, '#tab-expense-chart'), '再点当前 Tab 不该重写它的入场方向').toBe(x1);
  });

  test('点当前模式的按钮：子 Tab 不被拽回第一个（空点击）', async ({ appPage: page }) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-chart"]').click();
    await expect(page.locator('#tab-expense-chart')).toBeVisible();
    await expect.poll(() => paneX(page, '#tab-expense-chart')).toBe('1');

    await page.locator('#mode-expenses').click(); // 已经在消费模式里，再点一次「消费」

    await expect(page.locator('#tab-expense-chart'), '再点当前模式不该把子 Tab 拽回「消费记录」').toBeVisible();
    await expect(page.locator('#tab-expenses')).toBeHidden();
    expect(await paneX(page, '#tab-expense-chart'), '再点当前模式不该重播内层入场').toBe('1');
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

test.describe('净资产目标', () => {
  test('未设目标：报头里是一行「名称 + 动作」的设置行，不是一个不知道填什么的空框', async ({ appPage: page }) => {
    // 用户视角：空态原是一个整行的大框里塞一枚小按钮——看着像输入框，框里没有名字。
    // 正解：左侧写明这行是什么（目标净资产），右侧是动作，一行装得下。
    await gotoAssets(page);
    const panel = page.locator('#net-worth-target .target-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('目标净资产');
    await expect(panel.getByRole('button', { name: '设定目标' })).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.height, '空态应当是一行（不是被撑起来的空框）').toBeLessThan(64);
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

test.describe('本月预算卡（消费趋势）', () => {
  // 冻结时钟：卡里的「已花」按月聚合、「余下天数」按今天算，不冻就随真实日期漂移。
  // 必须 before goto（addInitScript 同层），否则首屏渲染已经用真实时间跑过一遍。
  const openTrendAt = async (page, state, iso) => {
    await page.clock.setFixedTime(new Date(iso));
    await openWith(page, state);
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await expect(page.locator('#month-pace-card')).toBeVisible();
  };

  const withMonthExpenses = (amounts, month = '2026-10') => ({
    ...sampleState(),
    expenses: amounts.map((a, i) => ({
      id: 'e-m' + i, date: `${month}-${String(i + 1).padStart(2, '0')}`, amount: a, note: '当月支出', tags: {},
    })),
  });

  // 把主题 CSS 变量解析成实际颜色：用浏览器自己算（探针元素走同一变量链），不写死 rgb
  const resolvedColor = (page, name) => page.evaluate((v) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${v})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);

  test('未超支：报剩余、余下天数与日均，不出现时间进度对照', async ({ page }) => {
    await openTrendAt(page, withMonthExpenses([600, 400]), '2026-10-06T10:00:00');
    await expect(page.locator('#pace-num')).toHaveText('¥1,000.00');
    await expect(page.locator('#pace-pct')).toHaveText('20.0%');
    // 10 月 31 天、6 号 → 余 26 天（今天算整天）
    await expect(page.locator('#pace-note')).toHaveText('预算剩 ¥4,000.00 · 余 26 天 · 日均 ¥153.85');
    // 尺子语义是预算容器：不带「今天」站点，也不再叙述时间进度
    await expect(page.locator('#month-pace-card .cov-marker')).toHaveCount(0);
    await expect(page.locator('#month-pace-card')).not.toContainText('时间进度');
    // 未超支时填充是活钱的 verdigris（而非警示色）
    const fillBg = await page.locator('#pace-fill').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fillBg).toBe(await resolvedColor(page, '--verdigris'));
  });

  test('超支：剩余归零、给出超出额，尺子与读数转警示色', async ({ page }) => {
    await openTrendAt(page, withMonthExpenses([3200, 2600]), '2026-10-06T10:00:00');
    await expect(page.locator('#pace-pct')).toHaveText('116.0%');
    await expect(page.locator('#pace-note')).toHaveText('已超预算 ¥800.00 · 本月额度已用完');
    // 填充物理封顶（右端即整月预算），真实百分比留在读数里
    await expect(page.locator('#pace-fill')).toHaveCSS('width', await page.locator('#month-pace-card .cov-track')
      .evaluate((el) => getComputedStyle(el).width));
    const fillBg = await page.locator('#pace-fill').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fillBg).toBe(await resolvedColor(page, '--down'));
    await expect(page.locator('#pace-note')).toHaveCSS('color', await resolvedColor(page, '--down'));
  });

  test('预算将尽（≥90%）但未超支：尺子转金，读数仍报剩余', async ({ page }) => {
    await openTrendAt(page, withMonthExpenses([4600]), '2026-10-06T10:00:00');
    await expect(page.locator('#pace-pct')).toHaveText('92.0%');
    await expect(page.locator('#pace-note')).toContainText('预算剩 ¥400.00');
    const fillBg = await page.locator('#pace-fill').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fillBg).toBe(await resolvedColor(page, '--accent'));
  });

  test('打平：预算刚好花完，没有可叙述的差额', async ({ page }) => {
    await openTrendAt(page, withMonthExpenses([5000]), '2026-10-06T10:00:00');
    await expect(page.locator('#pace-pct')).toHaveText('100.0%');
    await expect(page.locator('#pace-note')).toBeHidden();
  });

  test('月初当天：余下天数含今天，分母不为 0', async ({ page }) => {
    await openTrendAt(page, withMonthExpenses([]), '2026-10-01T09:00:00');
    await expect(page.locator('#pace-note')).toHaveText('预算剩 ¥5,000.00 · 余 31 天 · 日均 ¥161.29');
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

  test('确认框叠在别的弹窗上时，指针与 ESC 都落到确认框（不是那层被盖住的）', async ({ appPage: page }) => {
    // 15 个遮罩的 z-index 都是同一个值，谁在上面只由 DOM 次序决定。确认框在 DOM 里排在
    // 消费分类弹窗**之前**，于是「编辑分类 → 删掉有引用的标签 → 弹确认」时确认框整个被盖住：
    // Playwright 实测 clicks 被 <form id="expense-category-form"> 拦截，真实用户看到的则是
    // 「点确认没反应、点取消也没反应」，而 ESC 会把**下层**弹窗关掉。
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-categories"]').click();
    await page.locator('#expense-categories-list .card', { hasText: '消费类型' }).getByRole('button', { name: '编辑' }).click();
    await expect(page.locator('#expense-category-modal')).toBeVisible();
    await page.fill('#expense-cat-tags', '住房'); // 移除仍被引用的「餐饮」→ 确认框
    await page.locator('#expense-category-form button[type="submit"]').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#expense-category-modal'), '分类弹窗仍开着（确认框是叠在它上面）').toBeVisible();

    // 命中测试：确认按钮中心点上，最上层的元素必须属于确认框
    const hit = await page.evaluate(() => {
      const r = document.getElementById('confirm-ok-btn').getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { covered: !!el && !el.closest('#confirm-modal') };
    });
    expect(hit.covered, '确认按钮必须真的在最上层（同 z-index 时 DOM 次序说了算）').toBe(false);

    // ESC 也必须落在最上层：关掉确认框、下层弹窗留着
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#expense-category-modal'), 'ESC 不能关掉被叠住的那层').toBeVisible();

    // 再弹一次，用真实指针点「取消」：数据不变
    await page.locator('#expense-category-form button[type="submit"]').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.locator('#confirm-modal button:has-text("取消")').click();
    await expect(page.locator('#confirm-modal')).toBeHidden();
    const st = await readStored(page);
    expect(st.expenseCategories.find((c) => c.id === 'ec-type').tags).toEqual(['餐饮', '住房']);
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

  test('错误的播报档位是 assertive，成功/知会是 polite（读屏器只认 live region 的档位）', async ({ appPage: page }) => {
    // 便条容器原先写死 aria-live="polite"：22 处 error 全都被排队到用户下次操作之后才念，
    // 而 error 的语义是「出错了、等你处理」——降级成「顺口提一句」。
    // 判据（toastLiveMode）在 logic.js 单测里钉住，这里验的是**它真的写到了 DOM 上**。
    await expect(page.locator('#toast-area')).toHaveAttribute('aria-live', 'polite');

    // error 便条：档位必须切到 assertive
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await page.fill('#expense-amount', '0');
    await page.locator('#expense-form button:has-text("保存")').click();
    await expect(page.locator('#toast-area .toast', { hasText: '金额必须大于 0' })).toBeVisible();
    await expect(page.locator('#toast-area'), '出错的便条必须走 assertive').toHaveAttribute('aria-live', 'assertive');

    // success 便条：档位要切回 polite（否则下一次知会也会打断朗读）
    await page.keyboard.press('Escape');
    await expect(page.locator('#expense-modal')).toBeHidden();
    await page.evaluate(() => setBackupFreq('daily'));
    await expect(page.locator('#toast-area .toast').first()).toBeVisible();
    await expect(page.locator('#toast-area'), '成功便条应回落 polite').toHaveAttribute('aria-live', 'polite');
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

test.describe('分类标签改名（迁移引用，不是清空）', () => {
  test('长按满时长即进编辑态（不必等松手）：资产与读数卡的引用跟着迁移，不留下空 key', async ({ page }) => {
    // 读数卡所选标签同按「分类 + 名字」引用，一并验证：曾用 pruneRunwayTags 清理，
    // 改名会把用户选好的标签静默取消掉
    const state = { ...sampleState(), runwayTags: [{ catId: 'cat-type', tag: '活期现金' }] };
    await openWith(page, state);
    await gotoAssetsTab(page, 'categories');

    const card = page.locator('#categories-list .card', { hasText: '资产类型' });
    // 改名入口是**长按整枚胶囊**（卡片上的编辑图标已去掉）：先短按一次证明它不响应，
    // 再按满 TAG_PRESS_MS 进入编辑态——两条都测，否则「点一下就进编辑」也会绿。
    const pill = card.locator('.tag-pill', { hasText: '活期现金' });
    const input = page.locator('#categories-list .tag-rename-input');
    const box = await pill.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(input).toHaveCount(0);

    // 用户实测：「得长按分类然后再松开才能编辑，我希望长按到时间就自动编辑」——
    // 满时长那一瞬输入框就该出现，**手还按着**（与「进资产页」按满即弹同一处置）
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(input, '按满时长即进编辑态（不必等松手）').toBeVisible({ timeout: 3000 });
    await expect(input).toBeFocused();
    // 抬手那一下不参与：输入框还在、焦点还在、整名仍选中（落在输入框上的点击会把
    //「全选好、直接打」收成一根光标；落点若是被挤开的隔壁胶囊 ✕，那就是删数据）
    await page.mouse.up();
    await expect(input).toBeFocused();
    expect(await input.evaluate((el) => [el.selectionStart, el.selectionEnd]), '整名保持选中').toEqual([0, 4]);
    await input.fill('现金类');
    await input.press('Enter');

    await expect(card.locator('.tag-pill', { hasText: '现金类' })).toHaveCount(1);
    await expect(card.locator('.tag-pill', { hasText: '活期现金' })).toHaveCount(0);
    await expectToast(page, '标签已重命名');

    const st = await readStored(page);
    const cat = st.categories.find((c) => c.id === 'cat-type');
    expect(cat.tags).toEqual(['现金类', '权益基金']);
    expect(st.assets.map((a) => a.tags['cat-type'])).toEqual(['现金类', '权益基金', '现金类']);
    expect(st.runwayTags).toEqual([{ catId: 'cat-type', tag: '现金类' }]);

    // 列表上的 pill 同步（cfg.renderItems 接线）
    await gotoAssetsTab(page);
    await expect(page.locator('#assets-rows .tag-pill', { hasText: '现金类' })).toHaveCount(2);
  });

  test('内置分类的胶囊只读：没有改名/删除入口，按满也不出编辑框', async ({ appPage: page }) => {
    // 币种代码是写死的逻辑：改名与删除在守卫里都只回一句「内置分类不可修改」。
    // 原先胶囊照挂长按改名入口 → 输入框弹出、提交被守卫拒绝（守卫只是 return，没人收走它）
    // → 用户实测「长按内置的货币类型，然后点其他地方不能取消编辑」。
    await gotoAssetsTab(page, 'categories');
    const card = page.locator('#categories-list .card', { hasText: '货币类型' });
    const pill = card.locator('.tag-pill', { hasText: 'CNY' });
    await expect(pill).toHaveCount(1);
    await expect(pill.locator('.pill-del'), '内置分类的标签删不掉，就不该有 ✕').toHaveCount(0);
    expect(await pill.getAttribute('data-rename'), '不给改名入口（没有 data-rename，长按也不会开始计时）').toBeNull();
    expect(await pill.getAttribute('tabindex'), '也不进 Tab 序：键盘不该够到一个不可能成立的动作').toBeNull();
    expect(await pill.getAttribute('role')).toBeNull();

    // 真按住满时长：仍然什么都不发生（负向断言只能真等——手势本身就是时间）
    const box = await pill.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await holdPastTagPress(page);
    await page.mouse.up();
    await expect(page.locator('#categories-list .tag-rename-input')).toHaveCount(0);
    expect(await pill.evaluate((el) => el.className), '连按住的反馈都不该有').toBe('tag-pill');
  });

  test('编辑期间分类在别处被删掉：点其他地方不得留下一个没人收的输入框', async ({ appPage: page }) => {
    // 用户实测的另一半：「点其他地方不能取消编辑」。renameTagGeneric 的每条拒绝路径
    //（分类不存在 / 内置 / 重名 / 旧名过期）都只是 return，收尾必须由 finish 兜住。
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await gotoAssetsTab(page, 'categories');
    const card = page.locator('#categories-list .card', { hasText: '资产类型' });
    const pill = card.locator('.tag-pill', { hasText: '活期现金' });
    const box = await pill.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const input = page.locator('#categories-list .tag-rename-input');
    await expect(input).toBeVisible({ timeout: 3000 });
    await page.mouse.up();

    // 分类在编辑期间消失（只改内存态，不重绘——重绘会把输入框一起收走，那就验不到收尾了）
    await page.evaluate(() => {
      state.categories = state.categories.filter((c) => c.id !== 'cat-type');
    });
    await page.mouse.click(400, 90); // 点别处：blur → 提交 → 分类已不在 → 必须把胶囊放回去
    await expect(input, '编辑框必须有归宿').toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('编辑框里删掉有引用的标签：先弹确认；取消则数据不变，确认后才清空', async ({ appPage: page }) => {
    await gotoAssetsTab(page, 'categories');
    await page.locator('#categories-list .card', { hasText: '资产类型' }).getByRole('button', { name: '编辑' }).click();
    await expect(page.locator('#category-modal')).toBeVisible();
    await page.fill('#cat-tags', '权益基金');
    await page.locator('#category-form button:has-text("保存")').click();

    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#confirm-msg')).toContainText('活期现金');
    await page.locator('#confirm-modal button:has-text("取消")').click();
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#category-modal')).toBeVisible();
    const kept = await readStored(page);
    expect(kept.categories.find((c) => c.id === 'cat-type').tags).toEqual(['活期现金', '权益基金']);
    expect(kept.assets.map((a) => a.tags['cat-type'])).toEqual(['活期现金', '权益基金', '活期现金']);

    await page.locator('#category-form button:has-text("保存")').click();
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#category-modal')).toBeHidden();
    const st = await readStored(page);
    expect(st.categories.find((c) => c.id === 'cat-type').tags).toEqual(['权益基金']);
    expect(st.assets.map((a) => a.tags['cat-type'])).toEqual([undefined, '权益基金', undefined]);
  });
});

test.describe('资产侧数据校验（快照按当时数据保留，不随补）', () => {
  test('新增分类后出现校验条；一键补齐只改当前资产，快照与另一侧不受影响', async ({ page }) => {
    const base = sampleState();
    const state = {
      ...base,
      categories: [...base.categories, { id: 'cat-new', name: '资产大类', builtin: false, tags: ['股票型', '债券型'] }],
      snapshots: [{
        month: '2026-01',
        note: '初始',
        currencyRates: { CNY: 1, HKD: 0.92, USD: 7.24 },
        assets: base.assets.map((a) => ({ ...a, tags: { ...a.tags } })),
        updatedAt: '2026-01-31T00:00:00.000Z',
      }],
    };
    await openWith(page, state);

    // 两条校验条各归各的 Tab：资产侧的缺口不得在消费记录页冒出来
    await expect(page.locator('#tagcheck-bar-expense')).toBeHidden();
    await gotoAssetsTab(page);
    await expect(page.locator('#tagcheck-bar-assets')).toBeVisible();
    await expect(page.locator('#tagcheck-bar-assets')).toContainText('3');
    await expect(page.locator('#tagcheck-bar-assets')).toContainText('资产大类');

    await page.locator('#tagcheck-bar-assets button:has-text("去校验")').click();
    await expect(page.locator('#tagcheck-modal')).toBeVisible();
    // 资产侧必须先说清历史快照不随补，否则用户会以为历史图表会跟着变
    await expect(page.locator('#tagcheck-hint')).toContainText('快照');
    await page.locator('#tagcheck-groups .tagcheck-batch .tag-choice', { hasText: '股票型' }).click();
    await expectToast(page, '已为 3 条记录打上「股票型」');

    const st = await readStored(page);
    expect(st.assets.map((a) => a.tags['cat-new'])).toEqual(['股票型', '股票型', '股票型']);
    expect(st.snapshots[0].assets.every((a) => a.tags['cat-new'] === undefined)).toBe(true);
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

  test('页脚加权平均利率与 Tips 的外推年化同基地（改一处即同步，不各自漂移）', async ({ appPage: page }) => {
    await gotoIncome(page);
    // 页脚「加权平均利率 X%」中的 X 就是有息本金的加权均值
    const footer = await page.locator('#income-summary-footer').textContent();
    const avgRate = parseFloat(footer.match(/加权平均利率 ([\d.]+)%/)[1]);

    await page.locator('#cov-reading .tip-mark').hover();
    const bubble = await page.locator('#cov-shortfall-tip').textContent();
    const effRate = parseFloat(bubble.match(/实际年化 ([\d.]+)%/)[1]);

    // 安全边际 100% 时两者应相等（同为有息本金基地）；若页脚另算基地就会分叉
    expect(avgRate).toBeCloseTo(effRate, 1);
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

/*
 * 台灯掠光（跟随指针的纸面光）。
 * 单测只能守「换算函数正确」与「接线唯一」，守不住「事件真的接上了、值真的写进去了」——
 * 这一组在真实浏览器里跑一遍指针，把「手一动纸面就亮」钉住。
 */
test.describe('台灯掠光（纸面光跟随指针）', () => {
  /** 读固定层上的两个 CSS 变量（灯的位置全在这里） */
  const lampPos = (page) =>
    page.evaluate(() => {
      const el = document.querySelector('.lamp-layer');
      return {
        x: el.style.getPropertyValue('--lamp-x'),
        y: el.style.getPropertyValue('--lamp-y'),
        on: el.classList.contains('on'),
      };
    });

  /**
   * 这组用例不能用 appPage：它在 fixtures 里统一开了 emulateMedia({reducedMotion:'reduce'})
   * 给整套提速，而减动效下台灯本来就该关掉。要验灯就得按普通环境起页。
   */
  const lampPage = async (page, opts) => {
    await stubCdn(page);
    await seed(page, sampleState());
    await page.goto(INDEX_URL);
    await waitReady(page);
  };

  test('指针移动：纸面光跟到指针处（坐标为视口百分比）', async ({ page }) => {
    await lampPage(page);
    const size = page.viewportSize();
    await page.mouse.move(size.width * 0.25, size.height * 0.5);
    await expect.poll(async () => (await lampPos(page)).x).toBe('25%');
    await expect.poll(async () => (await lampPos(page)).y).toBe('50%');
    await expect.poll(async () => (await lampPos(page)).on).toBe(true);

    await page.mouse.move(size.width * 0.75, size.height * 0.25);
    await expect.poll(async () => (await lampPos(page)).x).toBe('75%');
    await expect.poll(async () => (await lampPos(page)).y).toBe('25%');
  });

  test('窗口尺寸变化后按新尺寸重算（否则灯会停在指针左边）', async ({ page }) => {
    await lampPage(page);
    // 回归：setLampAt 之前复用 updateLamp(e) 的入参形状，resize 路径传的是 {x,y} 而函数读 e.clientX，
    // 于是守卫静默丢弃、灯再也不重算——指针在 25% 处，放大窗口后灯还赖在 25%（应为 12.5%）
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.mouse.move(250, 400); // 25% / 50%
    await expect.poll(async () => (await lampPos(page)).x).toBe('25%');

    await page.setViewportSize({ width: 2000, height: 800 });
    await expect.poll(async () => (await lampPos(page)).x, { message: '同一坐标在新宽度下应变成 12.5%' }).toBe('12.5%');
  });

  test('减动效下不跟随（要求安静时不该还有一层光在动）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await lampPage(page);
    // 不用 waitForTimeout（AGENTS.md 禁止）：pointermove → setLampAt → syncLamp 是同步的，
    // 而 page.evaluate 本身就是一次往返，回到这里时处理早已完成
    await page.mouse.move(300, 300);
    const st = await lampPos(page);
    expect(st.on, '减动效下不得点亮').toBe(false);
    expect(st.x, '减动效下坐标都不该被写入').toBe('');
    // CSS 侧也有一道闸：即使 JS 漏了，光层也不该被画出来
    const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.lamp-layer')).display);
    expect(hidden).toBe('none');
  });
});

/*
 * 分布图的构成清单（旭日图右侧那一栏）。
 * --------------------------------------------------------------------------
 * 清单是**纯 DOM**（数据来自 buildSunburstData，不依赖 echarts 渲染），所以这一组
 * 照旧走 stub 装置、不碰外网（见 AGENTS.md：E2E 断网也要能跑）。
 * 要钉住的坑：内环分类节点本身**不带 value**（ECharts 是按 children 求和定扇区大小），
 * 清单若直接读 n.value 就会满屏 ¥0.00 —— 而图是正常的，只看图发现不了。
 */
test.describe('行级可点元素：指针与键盘两条路都要给', () => {
  // 用户实测：这些行用鼠标点得动，键盘却到不了（cursor:pointer + tabIndex=-1）。
  // 更早还留下过一块化石：旭日图清单写了 :focus-visible 规则，但行拿不到焦点，
  // 那条规则永远无法命中——样式在、路不在。
  //
  // 判据必须是**真实按键**：属性写对了但处理体语法坏掉（if 少一个花括号）时，
  // 浏览器只在事件触发那一刻才编译它，表现为「按了毫无反应且不报错」。
  // 单测看不见这一层，只有真按下去才知道。
  const keyBoth = async (page, locator) => {
    await locator.focus();
    const focused = await locator.evaluate((el) => el === document.activeElement);
    expect(focused, '行必须先真的能拿到焦点').toBe(true);
    // 按键 → 弹窗开/合都是同步接线：用可见性自动等到位（原先 sleep 250/200 是盲等，
    // 慢机器上会飘、快机器上白等）
    const pressOpens = async (key) => {
      await locator.focus();
      await page.keyboard.press(key);
      let opened = true;
      try {
        await page.locator('#snapshot-modal').waitFor({ state: 'visible', timeout: 1500 });
      } catch (e) {
        opened = false; // 没打开就是没打开，交给调用方断言
      }
      if (opened) {
        await page.keyboard.press('Escape');
        await expect(page.locator('#snapshot-modal')).toBeHidden();
      }
      return opened;
    };
    const byEnter = await pressOpens('Enter');
    const bySpace = await pressOpens(' ');
    return { byEnter, bySpace };
  };

  test('快照行：Enter 与 Space 都能打开详情', async ({ appPage: page }) => {
    await gotoAssets(page, 'history');
    await page.evaluate(() => takeSnapshot());
    await page.locator('#snapshot-note-modal').waitFor({ state: 'visible' });
    await page.locator('#snapshot-note-modal .btn-gold').first().click();
    await expect(page.locator('#snapshots-list .row-hit')).toHaveCount(1);
    const r = await keyBoth(page, page.locator('#snapshots-list .row-hit').first());
    expect(r.byEnter, '快照行 Enter 应打开详情').toBe(true);
    expect(r.bySpace, 'Space 是读屏器用户最惯用的激活键，不能只做 Enter').toBe(true);
  });

  test('月度明细/分类构成：日期按文本渲染（导入的脏 date 不得成为 HTML）', async ({ page }) => {
    // 备注、标签名都走了 esc，日期却是裸插值——而 date 来自导入的 JSON（migrateState 只补空值、
    // 不校验形状）。一行 `2026-01<img src=x onerror=...>` 就能在明细弹窗里执行脚本。
    const evilDate = '2026-01<img src=x onerror="window.__xss=1">';
    await openWith(page, {
      ...sampleState(),
      expenses: [
        { id: 'e-x', date: evilDate, amount: 10, note: '脏数据', tags: { 'ec-pay': '微信' } },
      ],
    });
    await page.evaluate(() => viewExpenseMonth('2026-01'));
    await expect(page.locator('#snapshot-modal')).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('#snapshot-detail-content .asset-row').nth(1))
      .toContainText('<img src=x onerror="window.__xss=1">');

    await page.keyboard.press('Escape');
    await page.evaluate(() => viewExpenseSegment('2026-01', 'ec-pay', '微信'));
    await expect(page.locator('#snapshot-modal')).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('#snapshot-detail-content .asset-row').nth(1))
      .toContainText('<img src=x onerror="window.__xss=1">');
  });

  test('消费趋势月份行：Enter 能打开当月明细', async ({ appPage: page }) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await expect(page.locator('#expense-trend-list .row-hit').first()).toBeVisible();
    const r = await keyBoth(page, page.locator('#expense-trend-list .row-hit').first());
    expect(r.byEnter, '趋势月份行 Enter 应打开明细').toBe(true);
    expect(r.bySpace).toBe(true);
  });

  test('旭日图清单：只有会下钻的顶层行可聚焦，Enter 真能下钻', async ({ appPage: page }) => {
    await gotoAssets(page, 'chart');
    await expect(page.locator('#chart-legend .row-hit').first()).toBeVisible();
    // 明细行的悬停高亮是「看着这里」而非导航，不该占 Tab 序
    const onlyTops = await page.locator('#chart-legend .chart-legend-row').evaluateAll((els) =>
      els.every((e) => (e.dataset.top === '1' ? e.classList.contains('row-hit') : !e.classList.contains('row-hit')))
    );
    expect(onlyTops, '只有顶层行走 row-hit（可点即键盘可达，不可点就不该抢焦点）').toBe(true);
    const row = page.locator('#chart-legend .row-hit').first();
    const before = (await page.locator('#chart-legend-head').textContent()).trim();
    await row.focus();
    expect(await row.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Enter');
    // 下钻渲染是同步的：等「返回条真的出现」再取文本（比盲等 500ms 快，且不会在慢机器上假绿）
    await expect(page.locator('#chart-legend-head')).toContainText('全部分类');
    const after = (await page.locator('#chart-legend-head').textContent()).trim();
    expect(after, 'Enter 应真的下钻（标题换成返回条 + 分类名）').not.toBe(before);
  });

  test('导入控件：Tab 能到，且原生打开选择框（不是只有鼠标够得到的 label）', async ({ appPage: page }) => {
    // 实测缺陷：原来的 <label for="import-file"> 的 tabIndex 是 -1（label 不是控件），
    // 而它的 <input type="file"> 又是 display:none —— 两头都进不了 Tab 序，
    // 键盘用户整块够不到「导入数据」（Shift+Tab 直接跳过它）。这里按真实按键验一遍。
    await page.evaluate(() => showImportExport());
    await expect(page.locator('#io-modal')).toBeVisible();

    // 从导出按钮往后 Tab：主张焦点会落到 file input，且视觉焦点环画在看得见的 label 上
    await page.locator('#io-modal .btn-gold').first().focus();
    await page.keyboard.press('Tab');
    const landed = await page.evaluate(() => {
      const ae = document.activeElement;
      const label = ae.closest ? ae.closest('.file-label') : null;
      return {
        id: ae.id,
        tag: ae.tagName,
        insideLabel: !!label,
        outline: label ? getComputedStyle(label).outlineWidth : null,
      };
    });
    expect(landed.id, 'Tab 应停在 file input 上（而不是跳过整个导入区）').toBe('import-file');
    expect(landed.tag).toBe('INPUT');
    expect(landed.insideLabel, 'label 必须包住 input，焦点环才画得到看得见的地方').toBe(true);
    expect(landed.outline, ':focus-within 应给出可见焦点环').toBe('2px');

    // 控件仍然看得见、点得到（不是被 sr-only 连视觉一起藏掉）
    const box = await page.locator('#io-modal .file-label').boundingBox();
    expect(box.width, '可见的导入按钮不能被藏起来').toBeGreaterThan(60);
    expect(box.height).toBeGreaterThan(20);
  });

  test('排序表头：Space 与 Enter 同义，且方向真的到达读屏器（可访问名）', async ({ appPage: page }) => {
    await gotoAssets(page, 'assets');
    // 用「金额」表头的 role 定位，避免在属性选择器里再嵌一层引号
    const head = page.getByRole('button', { name: /^金额/ }).first();
    await expect(head).toHaveAttribute('aria-sort', 'none');
    await head.focus();

    // **可访问名**才是真正到达读屏器的通道：aria-sort 按 WAI-ARIA 规范未定义在
    // role=button 上（那位子是 columnheader/rowheader），实测 Chrome 的 AX 树里
    // 那枚属性不产生任何 sort 信息。原先这条用例只断言属性在变——属性变了、
    // 读屏器却收不到，正是「写对了 ARIA 但没生效」那一类。故改成断言 AX 快照。
    await page.keyboard.press(' ');
    await expect(head, 'Space 应能排序（role=button 的两种预期键位）').toHaveAttribute('aria-sort', 'ascending');
    await expect(head).toHaveAttribute('aria-label', '金额，已按升序排列');
    expect(await head.ariaSnapshot(), '升序必须能在 AX 树里读出来').toContain('已按升序排列');

    await page.keyboard.press('Enter');
    await expect(head).toHaveAttribute('aria-sort', 'descending');
    expect(await head.ariaSnapshot(), '降序必须能在 AX 树里读出来').toContain('已按降序排列');

    // 第三次回到未排序：可访问名要收回方向，否则方向粘在上一列上
    await page.keyboard.press('Enter');
    await expect(head, '第三次回到未排序').toHaveAttribute('aria-sort', 'none');
    await expect(head, '回到未排序时方向必须从可访问名里撤掉').toHaveAttribute('aria-label', '');
    expect(await head.ariaSnapshot()).not.toContain('排列');

    // 可见列名必须留在可访问名里（WCAG 2.5.3「名称包含可见文字」，否则语音控制喊不出这一列）
    await page.keyboard.press(' ');
    expect(await head.ariaSnapshot(), '可访问名必须含可见列名「金额」').toContain('金额');
  });
});

test.describe('弹窗焦点管理（aria-modal 的兑现）', () => {
  // 15 个弹窗都写了 role="dialog" aria-modal="true"——那是对读屏器的承诺：弹窗背后的
  // 内容不可达。实测却完全没接管焦点：打开后焦点还在背后的触发按钮上、第一下 Tab 就走出
  // 弹窗、关闭后掉到 body。写对了 ARIA 不等于做了行为，这里按真实按键验一遍。
  test('打开后焦点搬进弹窗，Tab 被困在里面，关闭后还回触发按钮', async ({ appPage: page }) => {
    const opener = page.locator('#tab-expenses button:has-text("记录消费")').first();
    await opener.focus();
    await opener.click();
    await expect(page.locator('#expense-modal')).toBeVisible();

    // 1) 焦点必须已经进弹窗（不是留在背后的触发按钮上）
    const onOpen = await page.evaluate(() => {
      const ae = document.activeElement;
      return { inside: document.getElementById('expense-modal').contains(ae), id: ae.id, tag: ae.tagName };
    });
    expect(onOpen.inside, '打开后焦点必须在弹窗内（留在背后 = aria-modal 是空话）').toBe(true);
    expect(onOpen.tag, '焦点应落在第一个表单控件上（弹窗多半是「填个表」）').toBe('INPUT');

    // 2) Tab 若干次不得跑出弹窗
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() =>
        document.getElementById('expense-modal').contains(document.activeElement));
      expect(inside, `第 ${i + 1} 次 Tab 之后焦点逃出了弹窗`).toBe(true);
    }
    // 3) Shift+Tab 往回也不能逃
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(() =>
        document.getElementById('expense-modal').contains(document.activeElement));
      expect(inside, `第 ${i + 1} 次 Shift+Tab 之后焦点逃出了弹窗`).toBe(true);
    }

    // 4) 关闭后焦点回到打开它的按钮，而不是掉到 body 让用户从页头重新 Tab
    await page.keyboard.press('Escape');
    await expect(page.locator('#expense-modal')).toBeHidden();
    const afterClose = await page.evaluate(() => ({
      isBody: document.activeElement === document.body,
      text: (document.activeElement.textContent || '').trim(),
    }));
    expect(afterClose.isBody, '关闭后焦点不得掉到 body').toBe(false);
    expect(afterClose.text, '焦点应回到打开弹窗的那个按钮').toContain('记录消费');
  });

  test('叠层弹窗：确认框叠在分类弹窗之上，关掉后焦点回到被叠住的那层（栈式回还）', async ({ appPage: page }) => {
    // 真实路径：分类弹窗里改标签 → 删掉一个仍被引用的标签 → saveCategoryGeneric 弹确认框。
    // 此时**分类弹窗还开着**，确认框叠在它上面——这才是「弹窗叠弹窗」。
    await gotoAssets(page, 'categories');
    // 编辑「资产类型」（标签：活期现金 / 权益基金，两者都被资产引用）
    await page.locator('#categories-list .card', { hasText: '资产类型' }).getByRole('button', { name: '编辑' }).click();
    await expect(page.locator('#category-modal')).toBeVisible();
    // 只留「活期现金」→ 「权益基金」成为被移除且有引用的标签 → 弹确认框
    await page.fill('#cat-tags', '活期现金');
    await page.locator('#category-modal button[type="submit"]').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#category-modal'), '分类弹窗必须仍开着（确认框叠在它上面）').toBeVisible();

    // 叠层最上层是确认框：焦点必须被拉到确认框里
    const inConfirm = await page.evaluate(() =>
      document.getElementById('confirm-modal').contains(document.activeElement));
    expect(inConfirm, '确认框打开时焦点应进确认框（而不是留在下层弹窗）').toBe(true);

    // Tab 只能在**最上层**循环：不得穿透到下面那层
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const stillInConfirm = await page.evaluate(() =>
      document.getElementById('confirm-modal').contains(document.activeElement));
    expect(stillInConfirm, 'Tab 必须困在最上层（确认框），不能穿透到被叠住的弹窗').toBe(true);

    // ESC 取消：确认框关掉，焦点应回到**下层那个弹窗内**（被叠住的那层），而不是掉到 body
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#category-modal')).toBeVisible();
    const backInside = await page.evaluate(() => {
      const ae = document.activeElement;
      return {
        isBody: ae === document.body,
        tag: ae.tagName,
        inCategoryModal: document.getElementById('category-modal').contains(ae),
      };
    });
    expect(backInside.isBody, '关掉上层后焦点不得掉到 body').toBe(false);
    expect(backInside.inCategoryModal, '焦点应回到被叠住的那层弹窗内（栈式回还）').toBe(true);
  });

  test('遮罩点击关弹窗也要还焦点（不能只改 display，绕过焦点管理）', async ({ appPage: page }) => {
    const opener = page.locator('#tab-expenses button:has-text("记录消费")').first();
    await opener.focus();
    await opener.click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    // 点遮罩空白处关闭
    await page.locator('#expense-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#expense-modal')).toBeHidden();
    const isBody = await page.evaluate(() => document.activeElement === document.body);
    expect(isBody, '遮罩点击关弹窗同样要把焦点还回去').toBe(false);
  });
});

test.describe('日期选择器与复制', () => {
  // 用户实测两处：
  //  ① 点「复制」时日期选择器自己弹出来（想要的只是「默认今天」）
  //  ② 日历里 18 号明明是周日，却被排在「周五」下面
  //
  // ②的根因是 CSS：`.flatpickr-day { max-width: 36px }`，而日历容器 308px、星期表头
  // 7 等分各 43.97px —— 36×8=288 < 308，于是**一行塞进 8 天**，表头却只有 7 个，
  // 整月错位。判据用「每行天数必须等于星期表头个数」，不写死 7（将来若改成 6 天制，
  // 这条仍然成立），也不依赖具体日期。
  //
  // ①的根因是「openModal 聚焦第一个表单控件」与 flatpickr「聚焦即展开」撞车。
  //
  // 这两条都必须在**真实 flatpickr** 下验证：E2E 的 stubCdn 把它换成了空壳。
  // 故本组用例自己注入一个最小 flatpickr 替身——它复刻真实库的两个关键行为
  // （聚焦即展开、setDate 不触发交互副作用），但不依赖外网。
  const FAKE = `
    window.flatpickr = function(sel, opts) {
      const el = document.querySelector(sel);
      const cal = document.createElement('div');
      cal.className = 'flatpickr-calendar';
      document.body.appendChild(cal);
      const open = () => { cal.classList.add('open'); };
      const close = () => { cal.classList.remove('open'); };
      const inst = {
        setDate(d, trigger) { el.value = d; if (trigger && opts.onChange) opts.onChange([d], d); },
        open, close,
        config: opts,
      };
      el._flatpickr = inst;
      el.addEventListener('focus', () => { if (opts.openOnFocus !== false) open(); });
      el.addEventListener('click', open);
      return inst;
    };
    window.flatpickr.l10ns = { zh: {} };
  `;

  test('点「复制」不得自动弹出日期选择器（只要默认今天）', async ({ page }) => {
    await stubCdn(page);
    await seed(page, sampleState());
    await page.addInitScript(FAKE);
    await page.goto('index.html');
    await waitReady(page);
    await page.locator('#expenses-rows .row-btn.copy').first().click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    // 标题是「复制消费」，日期是今天
    await expect(page.locator('#expense-modal-title')).toHaveText('复制消费');
    // 关键断言：日历不得处于展开态
    const open = await page.evaluate(() => !!document.querySelector('.flatpickr-calendar.open'));
    expect(open, '点「复制」时日期选择器不该自己弹出来').toBe(false);
  });

  test('日历网格：每天宽度不得写死像素（写死会让一行塞进 8 天、整月错位）', async ({ page }) => {
    // 根因是 CSS 而非 JS：`.flatpickr-day { max-width: 36px }`，而日历容器 308px、
    // 星期表头 7 等分各 43.97px —— 36×8=288 < 308，于是每行塞进 **8 天**，
    // 表头却只有 7 个，整月错位：2026-10-18（周日）被排到「周五」下面。
    //
    // 判据直接读**样式表里的规则文本**（不依赖 flatpickr 是否加载，也不靠探针布局——
    // 探针里 `calc(100%/7)` 的百分比基准与真实日历不同，量出来是假的）。
    // 要求：宽度必须是相对容器的方式（百分比 / calc），不得出现固定像素 max-width。
    await stubCdn(page);
    await seed(page, sampleState());
    await page.goto('index.html');
    await waitReady(page);

    const decl = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const r of rules) {
          if (r.selectorText && /\.flatpickr-day\b/.test(r.selectorText) && r.style && r.style.maxWidth) {
            return r.style.maxWidth;
          }
        }
      }
      return null;
    });

    expect(decl, '必须找到 .flatpickr-day 的 max-width 声明').toBeTruthy();
    // 固定像素值 = 那个 bug（36px）；相对值才跟着容器走
    expect(/^\d+(\.\d+)?px$/.test(decl.trim()), `max-width 不能是固定像素（当前 ${decl}）：容器一宽就会一行塞进 8 天`).toBe(false);
    expect(decl, 'max-width 应相对容器（百分比或 calc）').toMatch(/calc\(|%/);
  });
});

test.describe('资产排序的键盘通道', () => {
  // 拖拽把手原先只有 draggable——指针专属手势，键盘用户完全无法调整资产顺序。
  // 「可点即键盘可达」的判据：指针能到的路径，键盘也要能到。
  test('聚焦把手后 ↑/↓ 能移动资产顺序，焦点跟着走', async ({ appPage: page }) => {
    await gotoAssets(page, 'assets');
    const order = () => page.evaluate(() =>
      [...document.querySelectorAll('#assets-rows .asset-row')].map(r => r.dataset.id).join(','));
    const before = await order();
    expect(before).toBe('a-cash,a-fund,a-hk');

    // 聚焦第一行的把手，按 ↓：招商银行活期 应与 沪深300指数 交换
    const handle = page.locator('#assets-rows .asset-row[data-id="a-cash"] .drag-handle');
    await handle.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#assets-rows .asset-row[data-id="a-cash"] .drag-handle'))
      .toBeFocused(); // 焦点跟着被移动的行走（连续按才可用）
    expect(await order(), '↓ 应把该资产下移一格').toBe('a-fund,a-cash,a-hk');

    // 再按 ↓ 到底
    await page.keyboard.press('ArrowDown');
    expect(await order()).toBe('a-fund,a-hk,a-cash');
    // 到底后再按不越界
    await page.keyboard.press('ArrowDown');
    expect(await order(), '已在最后一行，再按 ↓ 不得越界').toBe('a-fund,a-hk,a-cash');

    // ↑ 两次回到顶部；到顶后再按不越界
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await order(), '↑ 三次后应回到原序（第三次已到顶，不越界）').toBe('a-cash,a-fund,a-hk');

    // 资产侧排序状态被清空（表头不再显示 ▲/▼ 激活态）。
    // 只数资产表头——消费侧日期列有默认排序，全站数会把不相干的 active 数进来。
    const active = await page.evaluate(() =>
      document.querySelectorAll('#assets-list .sort-indicator.active').length);
    expect(active, '移动顺序后应清除列排序状态').toBe(0);
  });
});

test.describe('Tab 滑动指示条', () => {
  // 用户要求：从「消费记录」切到「消费分布」时，小黄条从左边**滑**到右边，不是跳变。
  // 实现：指示条是 Tab 栏里唯一的一个元素，位置由 moveTabIndicator 写 CSS 变量，
  // transform/left 有过渡 → 滑动。判据：
  //   ① 全站只有两个指示条（每条 Tab 栏一个），不是每个按钮自带 border
  //   ② 切换后指示条几何位置 = 目标按钮的 offsetLeft/offsetWidth（滑到位）
  //   ③ 过渡存在（computed transition-duration > 0，减动效 fixture 会把它归零——
  //      故这条在 fixture 的 reducedMotion: 'reduce' 下断言 duration 为 0 即「尊重减动效」）
  test('切换 Tab 后指示条滑到目标按钮下方（几何对位）', async ({ appPage: page }) => {
    const geo = () => page.evaluate(() => {
      const bar = document.querySelector('#tabs-expenses .tab-bar');
      const ind = bar.querySelector('.tab-indicator');
      const btn = bar.querySelector('.tab-btn.active');
      const cs = getComputedStyle(ind);
      return {
        x: Math.round(parseFloat(cs.left)),
        w: Math.round(parseFloat(cs.width)),
        btnX: Math.round(btn.offsetLeft),
        btnW: Math.round(btn.offsetWidth),
        dur: cs.transitionDuration,
      };
    });

    const g1 = await geo();
    expect(g1.w, '初始指示条宽度应等于「消费记录」按钮宽').toBe(g1.btnW);

    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-chart"]').click();
    // 等指示条滑到位：轮询「位置与宽度都等于目标按钮」（正常 0.28s 过渡，减动效下瞬间到位）
    await expect
      .poll(async () => {
        const g = await geo();
        return g.x === g.btnX && g.w === g.btnW;
      }, { message: '指示条应滑到「消费分布」按钮的位置与宽度' })
      .toBe(true);
    const g2 = await geo();
    expect(g2.x, '指示条应滑到「消费分布」按钮的 offsetLeft').toBe(g2.btnX);
    expect(g2.w).toBe(g2.btnW);
    // 确实移动了（不是没动）
    expect(g2.x, '指示条必须真的移动了').not.toBe(g1.x);

    // 减动效 fixture 下过渡时长应为 0（尊重 prefers-reduced-motion）。
    // transitionDuration 可能是 "0.28s, 0.28s"（多个属性），每个值都要为 0。
    const durs = g2.dur.split(',').map((x) => parseFloat(x));
    // fixtures 把减动效实现为 0.001ms（1e-6s）而非严格 0 —— 判据「小于 1ms 即视为无过渡」
    expect(durs.every((d) => d < 0.001), `减动效时过渡时长应归零（当前 ${g2.dur}）`).toBe(true);
  });

  test('全站指示条数量 = Tab 栏数（不是每个按钮一根）', async ({ appPage: page }) => {
    const n = await page.evaluate(() => document.querySelectorAll('.tab-indicator').length);
    expect(n, '两条 Tab 栏各一根，共 2').toBe(2);
  });
});

test.describe('窄屏 Tab 栏：标签不许折行（横滚代替换行）', () => {
  // 用户实测（420px）：四个 Tab 各自折成两行（「消费记 录」「分类管 理」）——中文在词中折断，
  // 黄条也对不上任何一行。Tab 标签是最短的定长词汇，折行只会让它更难读；放不下就该横滚。
  const wrappedTabs = (page) =>
    page.evaluate(() => {
      const out = [];
      for (const bar of document.querySelectorAll('.tab-bar')) {
        for (const btn of bar.querySelectorAll('.tab-btn')) {
          if (!btn.getBoundingClientRect().width) continue; // 隐藏容器的 Tab 栏（display:none）
          const range = document.createRange();
          range.selectNodeContents(btn);
          if (range.getClientRects().length > 1) out.push(btn.textContent.trim());
        }
      }
      return out;
    });

  test('420px：消费侧四个 Tab 都只占一行，放不下时 Tab 栏横向滚动', async ({ appPage: page }) => {
    await page.setViewportSize({ width: 420, height: 900 });
    const wrapped = await wrappedTabs(page);
    expect(wrapped, `这些 Tab 标签折成了两行：${wrapped.join('、')}`).toEqual([]);
    const bar = await page.evaluate(() => {
      const b = document.querySelector('#tabs-expenses .tab-bar');
      return { overflowX: getComputedStyle(b).overflowX, sw: b.scrollWidth, cw: b.clientWidth };
    });
    expect(bar.overflowX, '放不下时该横滚（不该换成两行）').toBe('auto');
    expect(bar.sw, '内容宽度不应小于容器').toBeGreaterThanOrEqual(bar.cw);
  });

  test('420px：资产侧五个 Tab 也不折行（多一个 Tab 更容易被挤成两行）', async ({ appPage: page }) => {
    await page.setViewportSize({ width: 420, height: 900 });
    await gotoAssets(page);
    const wrapped = await wrappedTabs(page);
    expect(wrapped, `资产侧这些 Tab 标签折成了两行：${wrapped.join('、')}`).toEqual([]);
  });
});

test.describe('Tab/模式切换：入场方向感（内容从行的哪一端滑入）', () => {
  // 「顺滑过渡」升级为有方向的翻页：往右切内容自右滑入、往回切自左滑入。
  // 方向由 logic.js paneEnterShift 按实测 offsetLeft 判定，经 --pane-x 交给 keyframes；
  // 这里断言变量真的按方向写到了要入场的那块 pane 上（fixture 关了动效，变量与动效无关）。
  const paneX = (page, sel) =>
    page.evaluate(
      (s) => (getComputedStyle(document.querySelector(s)).getPropertyValue('--pane-x') || '').trim(),
      sel
    );

  test('切到右侧的 Tab：--pane-x=1；往回切：-1', async ({ appPage: page }) => {
    // 消费 Tab 次序（左→右）：消费记录 · 分类管理 · 消费分布 · 消费趋势
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-chart"]').click();
    await expect.poll(() => paneX(page, '#tab-expense-chart')).toBe('1');
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await expect.poll(() => paneX(page, '#tab-expense-trend')).toBe('1');
    // 从最右切回最左 = 往回翻页
    await page.locator('#tabs-expenses .tab-btn[data-tab="expenses"]').click();
    await expect.poll(() => paneX(page, '#tab-expenses')).toBe('-1');
  });

  test('模式切换同样带方向（消费在左、资产在右）；入场只挂内层面板，外壳不挂', async ({ appPage: page }) => {
    await gotoAssets(page);
    // 内层子 Tab 的方向由 switchMode 透传给 switchTab —— 一次「翻页」只有一个方向
    await expect.poll(() => paneX(page, '#tab-assets')).toBe('1');
    // 内层确实播了入场（.enter 挂在 [id^="tab-"] 面板上）
    await expect(page.locator('#tab-assets')).toHaveClass(/enter/);
    // 切回消费 = 反向
    await page.locator('#mode-expenses').click();
    await expect.poll(() => paneX(page, '#tab-expenses')).toBe('-1');
    // 外壳 content-* 不参与入场：动画选择器只认 [id^="tab-"]，对壳调 enterTab 是无人消费的死接线
    expect(
      await page.evaluate(() => document.querySelectorAll('#content-assets.enter, #content-expenses.enter').length),
      '外壳 content-* 不得挂 .enter（死接线已删，不得回潮）'
    ).toBe(0);
  });
});

test.describe('分布图的构成清单（与图同源）', () => {
  const legendRows = (page, listId) =>
    page.evaluate((id) =>
      [...document.querySelectorAll(`#${id} .chart-legend-row`)].map((r) => ({
        idx: r.dataset.idx,
        name: r.querySelector('.chart-legend-name').textContent.trim(),
        amt: r.querySelector('.chart-legend-amt').textContent.trim(),
        pct: r.querySelector('.chart-legend-pct').textContent.trim(),
        swatch: getComputedStyle(r.querySelector('.chart-legend-swatch')).backgroundColor,
      })), listId);

  test('资产分布：金额与占比非零，百分比之和为 100，且按值降序', async ({ appPage: page }) => {
    await gotoAssets(page, 'chart');
    await expect(page.locator('#chart-legend .chart-legend-row').first()).toBeVisible();
    const rows = await legendRows(page, 'chart-legend');
    // sampleState：CNY 50,000 + 80,000；HKD 50,000 ÷ 0.92 = 54,347.83 → 合计 184,347.83
    expect(rows.map((r) => r.name)).toEqual(['CNY', 'HKD']);
    expect(rows[0].amt).toBe('¥130,000.00');
    expect(rows[1].amt).toBe('¥54,347.83');
    for (const r of rows) {
      expect(r.amt, `「${r.name}」金额不得为 0（内环节点不带 value 的坑）`).not.toBe('¥0.00');
      expect(parseFloat(r.pct)).toBeGreaterThan(0);
    }
    const sum = rows.reduce((s, r) => s + parseFloat(r.pct), 0);
    expect(sum).toBeGreaterThan(99.5);
    expect(sum).toBeLessThan(100.5);
  });

  test('切到空维度：清单与图同生共死，不留上一次的行', async ({ appPage: page }) => {
    // 回归：清单容器是 chart 的兄弟节点，图被 showChartOrEmpty 藏起来时它不会自动消失，
    // 于是空态提示旁边会站着一份过期数据（同 hideChartTotal 的理由）
    await gotoAssets(page, 'chart');
    await expect(page.locator('#chart-legend .chart-legend-row').first()).toBeVisible();

    // 新建一个没有任何资产归类的维度并选中
    await page.evaluate(() => {
      state.categories.push({ id: 'cat-empty', name: '空维度', builtin: false, tags: ['甲', '乙'] });
      saveState(); renderCategories();
    });
    // 走真实路径回到「资产分布」：分类下拉由「进入该 Tab」这一档填（switchTab 里的
    // fillCategorySelect），而点当前已激活的 Tab 现在是空点击、不再重绘（用户实测要求）。
    await gotoAssets(page, 'assets');
    await gotoAssets(page, 'chart');
    await page.selectOption('#chart-category-select', 'cat-empty');
    await expect(page.locator('#chart-empty')).toBeVisible();
    await expect(page.locator('#chart-total')).toBeHidden();          // 总数早已会收起
    await expect(page.locator('#chart-legend .chart-legend-row')).toHaveCount(0); // 清单也必须清空
  });

  test('清单的色块与扇区同色板（idx 即 data 下标，不是排序后的行号）', async ({ appPage: page }) => {
    await gotoAssets(page, 'chart');
    await expect(page.locator('#chart-legend .chart-legend-row').first()).toBeVisible();
    const rows = await legendRows(page, 'chart-legend');
    // data 顺序 = 分类里的标签序（CNY 第 0、HKD 第 1），清单按值排但 idx 必须仍指向原位
    expect(rows.map((r) => r.idx)).toEqual(['0', '1']);
    const palette = await page.evaluate(() => CATEGORY_PALETTE.slice(0, 2).map((p) => p.base));
    const toRgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    expect(rows[0].swatch).toBe(toRgb(palette[0]));
    expect(rows[1].swatch).toBe(toRgb(palette[1]));

    // 下钻后色块必须仍是该分类的颜色：data 被裁成单个分类后下标恒为 0，
    // 若按下标重算色板，HKD（绿）的色块会变成 CNY 的红色（真实浏览器实测过）
    await page.locator('#chart-legend .chart-legend-row').nth(1).click();
    await expect(page.locator('#chart-legend .chart-legend-row')).toHaveCount(1);
    const drilled = await legendRows(page, 'chart-legend');
    const green = await page.evaluate(() => CATEGORY_PALETTE[1].shades[0]);
    expect(drilled[0].swatch, '下钻后色块跟着该分类走，不得变回第一个分类的色').toBe(toRgb(green));
  });

  test('收益分布：清单按当前口径（现金/总收益）列出，非零且随口径切换', async ({ appPage: page }) => {
    await gotoAssets(page, 'income');
    await expect(page.locator('#income-chart-legend .chart-legend-row').first()).toBeVisible();
    const cash = await legendRows(page, 'income-chart-legend');
    for (const r of cash) {
      expect(r.amt, `「${r.name}」金额不得为 0（内环节点不带 value 的坑）`).not.toBe('¥0.00');
    }
    const sum = cash.reduce((s, r) => s + parseFloat(r.pct), 0);
    expect(sum).toBeGreaterThan(99.5);

    // 切到总收益：同一批分类的金额应变化（现金口径 ≤ 总收益口径），占比各自仍为 100%
    await page.locator('#income-chart-mode-total').click();
    await expect.poll(async () => (await legendRows(page, 'income-chart-legend'))[0].amt).not.toBe(cash[0].amt);
    const total = await legendRows(page, 'income-chart-legend');
    expect(total.reduce((s, r) => s + parseFloat(r.pct), 0)).toBeGreaterThan(99.5);
  });

  test('选中分类后清单联动成该分类下的条目，能返回；换维度时选中态归零', async ({ appPage: page }) => {
    await gotoAssets(page, 'chart');
    await expect(page.locator('#chart-legend .chart-legend-row').first()).toBeVisible();
    const names = () => page.evaluate(() =>
      [...document.querySelectorAll('#chart-legend .chart-legend-name')].map((e) => e.textContent.trim()));
    const head = () => page.evaluate(() => document.getElementById('chart-legend-head').textContent.trim());

    // 初始：顶层分类（货币维度）
    expect(await names()).toEqual(['CNY', 'HKD']);
    expect(await head()).toBe('构成');

    // 点分类行 → 清单换成该分类下的资产；占比分母换成该分类合计（加起来 100%）
    await page.locator('#chart-legend .chart-legend-row').first().click();
    await expect.poll(names).toEqual(['沪深300指数', '招商银行活期']);
    expect(await head()).toContain('CNY');
    // 图本身也跟着下钻：喂给 ECharts 的数据只剩该分类（与清单同一套选中态）
    await expect.poll(() => page.evaluate(() => window.__echartsCalls.sunburstData)).toEqual(['CNY']);
    // 卡片总数也跟着换成该分类合计（否则图里的扇区与上方的数对不上）
    await expect(page.locator('#chart-total')).toHaveText('¥130,000.00');
    const pcts = await page.evaluate(() =>
      [...document.querySelectorAll('#chart-legend .chart-legend-pct')].map((e) => parseFloat(e.textContent)));
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    // 明细金额之和 = 该分类合计（分母与图上扇区同源）
    const amts = await page.evaluate(() =>
      [...document.querySelectorAll('#chart-legend .chart-legend-amt')].map((e) => Number(e.textContent.replace(/[^0-9.]/g, ''))));
    expect(amts.reduce((a, b) => a + b, 0)).toBeCloseTo(130000, 0);

    // 返回全部分类
    await page.locator('#chart-legend-head .legend-back').click();
    await expect.poll(names).toEqual(['CNY', 'HKD']);
    // 图本身也必须回到全景：这是用户报的那个 bug——清单回来了、图仍停在下钻层
    // （ECharts 原生 nodeClick 维护的 viewRoot 与清单选中态是两套状态）
    await expect.poll(() => page.evaluate(() => window.__echartsCalls.sunburstData)).toEqual(['CNY', 'HKD']);
    await expect(page.locator('#chart-total')).toHaveText('¥184,347.83');

    // 再下钻一次后换维度：选中态必须归零（否则切回同名维度会莫名又是下钻态）
    await page.locator('#chart-legend .chart-legend-row').first().click();
    await expect.poll(head).toContain('CNY');
    await page.selectOption('#chart-category-select', 'cat-type');
    await expect.poll(names).toEqual(['活期现金', '权益基金']);
    expect(await head()).toBe('构成');
    expect(await page.evaluate(() => JSON.stringify(sunburstLegendSel['chart-legend']))).toBe('null');

    // 点图上的扇区也能下钻：用 ECharts 替身派发一次真实形态的 click 事件
    // （params 形如 ECharts 给的：带 treePathInfo 祖先路径）。替身没有 canvas，
    // 点不到真扇区，但「点击参数 → 下钻 → 清单联动」这条链路能验；
    // 真实点击已由 logic 层的 sunburstNodePath 断言 + 本地真库探针覆盖
    await page.selectOption('#chart-category-select', 'currency');
    await expect.poll(names).toEqual(['CNY', 'HKD']);
    await page.evaluate(() => {
      // 用页面自己的 chart 变量（替身的 getInstanceByDom 返回 null）
      chart.dispatchAction({ type: 'click', name: 'HKD', dataIndex: 2, treePathInfo: [{ name: '', value: 0 }, { name: 'HKD', value: 1 }] });
    });
    await expect.poll(head).toContain('HKD');
    // 点到条目层（长度 3）不下钻：树只有两层，再钻没有下一层可去
    await page.locator('#chart-legend-head .legend-back').click();
    await expect.poll(names).toEqual(['CNY', 'HKD']);
    await page.evaluate(() => {
      chart.dispatchAction({ type: 'click', name: '招商银行活期', dataIndex: 3, treePathInfo: [{ name: '', value: 0 }, { name: 'CNY', value: 1 }, { name: '招商银行活期', value: 2 }] });
    });
    expect(await head(), '点条目不应下钻（明细已是最后一层）').toBe('构成');

    // 再点一次已选中的分类 = 返回全部分类（原生下钻已关，内环仍能点回去）
    await page.evaluate(() => {
      chart.dispatchAction({ type: 'click', name: 'HKD', dataIndex: 2, treePathInfo: [{ name: '', value: 0 }, { name: 'HKD', value: 1 }] });
    });
    await expect.poll(head).toContain('HKD');
    await page.evaluate(() => {
      chart.dispatchAction({ type: 'click', name: 'HKD', dataIndex: 2, treePathInfo: [{ name: '', value: 0 }, { name: 'HKD', value: 1 }] });
    });
    await expect.poll(head).toBe('构成');
    await expect.poll(() => page.evaluate(() => window.__echartsCalls.sunburstData)).toEqual(['CNY', 'HKD']);
  });

  test('消费分布：清单随月份筛选联动（切月后金额跟着变）', async ({ appPage: page }) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-chart"]').click();
    await expect(page.locator('#expense-chart-legend .chart-legend-row').first()).toBeVisible();
    const all = await legendRows(page, 'expense-chart-legend');
    expect(all.reduce((s, r) => s + parseFloat(r.pct), 0)).toBeGreaterThan(99.5);

    // sampleState 的消费：2026-01（微信 88.5 / 支付宝 3200）、2026-02（微信 42）
    await page.selectOption('#expense-chart-month-select', '2026-02');
    await expect.poll(async () => (await legendRows(page, 'expense-chart-legend')).length).toBe(1);
    const feb = await legendRows(page, 'expense-chart-legend');
    expect(feb[0].name).toBe('微信');
    expect(feb[0].amt).toBe('¥42.00');
    expect(feb[0].pct).toBe('100.0%');
  });

  test('悬停清单行高亮**对应**扇区：dataIndex 必须是扁平树下标（不是行号、也不是顶层下标）', async ({ appPage: page }) => {
    // 三种下标一次分清（这个坑踩过两次）：
    //   行号       —— 清单按值降序后的位置；用它就是「悬停 A 高亮 B」
    //   顶层下标   —— data 数组里的位置；**仍不对**：ECharts 的 dataIndex 是扁平树下标，
    //                 虚拟根占 0，于是顶层分类 N 对应 N+1（差一个），明细还要再加前面兄弟的份额
    //   扁平树下标 —— 唯一对的（logic.js sunburstNodePath 负责换算）
    // 用消费分布：清单按值降序（支付宝 3200 > 微信 88.5）而 data 是标签序（微信在前），
    // 三种下标互不相等，谁也糊弄不过去。
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-chart"]').click();
    await expect(page.locator('#expense-chart-legend .chart-legend-row').first()).toBeVisible();
    // 默认选中最新月份（2026-02 只有微信）；切到 1 月才有两个分类可比
    await page.selectOption('#expense-chart-month-select', '2026-01');
    await expect.poll(async () => (await legendRows(page, 'expense-chart-legend')).length).toBe(2);
    const rows = await legendRows(page, 'expense-chart-legend');
    expect(rows.map((r) => r.name), '清单按值降序').toEqual(['支付宝', '微信']);
    expect(rows.map((r) => r.idx), 'idx 仍指向 data 原位（色板取色用）').toEqual(['1', '0']);

    const dispatched = () => page.evaluate(() =>
      (window.__echartsCalls.dispatch || []).filter((d) => d.id === 'expense-sunburst-chart').map((d) => d.action));
    await page.evaluate(() => { window.__echartsCalls.dispatch.length = 0; });

    // 2026-01 的树：root=0, 微信=1, 午餐=2, 支付宝=3, 房租=4
    // → 悬停「支付宝」（data 顶层下标 1、清单行号 0）必须发 dataIndex 3
    await page.locator('#expense-chart-legend .chart-legend-row').first().hover();
    await expect.poll(dispatched).toEqual([{ type: 'highlight', seriesIndex: 0, dataIndex: 3 }]);

    await page.mouse.move(0, 0);
    await expect.poll(dispatched).toEqual([
      { type: 'highlight', seriesIndex: 0, dataIndex: 3 },
      { type: 'downplay', seriesIndex: 0, dataIndex: 3 },
    ]);
  });
});
