/*
 * e2e/stress.spec.js — 资产压测（全局视图叠加）
 * --------------------------------------------------------------------------
 * 压测改的是**读数**，不是**账本**——这条界线是整个功能的全部。E2E 在这里的价值正是
 * 那条界线只能靠真实浏览器验：
 *   · 报头/覆盖率/读数卡跟着变（单测只能验纯函数，验不到「有一处渲染忘了接」）；
 *   · **列表金额不变**、**快照存原值**（这是「不写账本」的唯一守卫）；
 *   · 刷新后情景仍在（落盘的唯一守卫）；
 *   · 改名后情景跟着迁移（不静默失效）。
 *
 * 滑块是**剩余比例**（拉满 100% = 没有亏损，拉到 50% = 跌一半）——存的是 keep，不是跌幅。
 *
 * 走键盘通道进资产页（fixtures.gotoAssets），不依外网、不用 waitForTimeout。
 */
const {
  test, expect, seed, stubCdn, waitReady, disableMotion, gotoAssets, EMPTY_STATE,
} = require('./fixtures');

// 播种一份带分类的账本：类型（活期/权益）+ 风险（低/高）+ 一笔未归类资产。
// 期望值便于心算：CNY 100k 活期 + 100k 权益 + 50k 未归类；权益剩 50% → 净资产 200k。
const stressState = () => ({
  ...EMPTY_STATE,
  categories: [
    { id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] },
    { id: 'cat-type', name: '资产类型', builtin: false, tags: ['活期现金', '权益基金'] },
    { id: 'cat-risk', name: '风险等级', builtin: false, tags: ['低风险', '高风险'] },
  ],
  assets: [
    { id: 'a-cash', name: '活期', amount: 100000, currency: 'CNY', tags: { currency: 'CNY', 'cat-type': '活期现金', 'cat-risk': '低风险' }, expectedRateMin: 1, expectedRateMax: 2, cashRatio: 100 },
    { id: 'a-fund', name: '指数基金', amount: 100000, currency: 'CNY', tags: { currency: 'CNY', 'cat-type': '权益基金', 'cat-risk': '高风险' }, expectedRateMin: 6, expectedRateMax: 6, cashRatio: 20 },
    { id: 'a-untagged', name: '待归类', amount: 50000, currency: 'CNY', tags: { currency: 'CNY' }, expectedRateMin: 0, expectedRateMax: 0, cashRatio: 100 },
  ],
  expenseExpectation: 5000,
});

/** 以压测用例的存档起页（seed 只在首次导航生效，故必须在 goto 之前播种） */
async function openStressPage(page) {
  await disableMotion(page);
  await stubCdn(page);
  await seed(page, stressState());
  await page.goto('index.html');
  await waitReady(page);
}

async function openStressModal(page) {
  await page.locator('#stress-bar .row-btn').click();
  await expect(page.locator('#stress-modal')).toBeVisible();
}

/** 在弹窗里把「权益基金」拉到剩 60% 并保存（权益基金是第二个标签）
 *  为什么不是 50%：那是「剩一半/跌一半」的对称点，语义写反也算出同一个数（用例会假绿）。 */
async function setFundKeepTo60(page) {
  const slider = page.locator('#stress-modal input[type="range"]').nth(1);
  await expect(slider).toBeVisible();
  await slider.fill('60');
  await slider.dispatchEvent('input');
  await expect(page.locator('#stress-modal .scale-reading').nth(1)).toHaveText('60%');
  await page.locator('#stress-modal .btn-gold').click();
  await expect(page.locator('#stress-modal')).toBeHidden();
}

test.describe('压测：读数跟着变，账本不动', () => {
  test('未启用时条说「未启用」，启用后报头变小并给出原值', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);

    await expect(page.locator('#stress-bar')).toBeVisible();
    await expect(page.locator('#stress-bar-text')).toHaveText('压测：未启用');
    await expect(page.locator('#stress-badge')).toBeHidden();
    await expect(page.locator('#masthead-whole')).toHaveText('250,000');

    await openStressModal(page);
    await setFundKeepTo60(page);

    await expect(page.locator('#masthead-whole')).toHaveText('210,000');
    await expect(page.locator('#stress-bar-text')).toContainText('权益基金 60%');
    await expect(page.locator('#stress-bar-text')).toContainText('未归类 ¥50,000.00 按未打折计入');
    await expect(page.locator('#masthead-sub')).toContainText('压测 -16.0%');
    await expect(page.locator('#masthead-sub')).toContainText('原值 ¥250,000');
    await expect(page.locator('#stress-badge')).toBeVisible();
    await expect(page.locator('#stress-badge-pct')).toHaveText(' -16.0%');
  });

  test('资产列表金额仍是原值（压测不写账本）', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundKeepTo60(page);

    // 报头已是压测后的数，列表必须是账本原值——这是「只改读数」的核心断言
    await expect(page.locator('#masthead-whole')).toHaveText('210,000');
    const amounts = page.locator('#assets-rows .asset-row .amount-cell span');
    await expect(amounts.nth(0)).toHaveText('100,000.00');
    await expect(amounts.nth(1)).toHaveText('100,000.00');
    await expect(amounts.nth(2)).toHaveText('50,000.00');
    await expect(page.locator('#assets-rows .asset-row').first()).toContainText('¥100,000.00');
  });

  test('保存快照存的是原值（历史是事实，不随压测打折）', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundKeepTo60(page);

    await page.locator('#tabs-assets .tab-btn[data-tab="history"]').click();
    await page.locator('#tab-history').getByRole('button', { name: '记录快照' }).click();
    await page.locator('#snapshot-note-modal .btn-gold').click();
    await expect(page.locator('#snapshot-note-modal')).toBeHidden();

    const snap = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('wealth-manager-data'));
      const snap = s.snapshots[s.snapshots.length - 1];
      return { total: snap.totalCNY, amounts: snap.assets.map((a) => a.amount), stress: s.stress };
    });
    expect(snap.total).toBe(250000);
    expect(snap.amounts).toEqual([100000, 100000, 50000]);
    expect(snap.stress).toEqual({ catId: 'cat-type', keeps: [{ tag: '权益基金', keep: 60 }] });
  });

  test('刷新后情景仍在（落盘），清除后回到真实值', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundKeepTo60(page);
    await expect(page.locator('#masthead-whole')).toHaveText('210,000');

    await page.reload();
    await gotoAssets(page);
    await expect(page.locator('#masthead-whole')).toHaveText('210,000');
    await expect(page.locator('#stress-bar-text')).toContainText('权益基金 60%');

    await openStressModal(page);
    await page.locator('#stress-modal .btn-danger').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.locator('#confirm-modal').getByRole('button', { name: '取消' }).click();
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#masthead-whole')).toHaveText('210,000');
    expect(await page.evaluate(() => state.stress)).toEqual({ catId: 'cat-type', keeps: [{ tag: '权益基金', keep: 60 }] });
    await expect(page.locator('#stress-modal')).toBeVisible();

    await page.locator('#stress-modal .btn-danger').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#masthead-whole')).toHaveText('250,000');
    await expect(page.locator('#stress-bar-text')).toHaveText('压测：未启用');
    await expect(page.locator('#stress-badge')).toBeHidden();
  });

  test('标签改名后情景跟着迁移（不静默失效）', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundKeepTo60(page);

    await page.locator('#tabs-assets .tab-btn[data-tab="categories"]').click();
    const pill = page.locator('#categories-list .tag-pill', { hasText: '权益基金' }).first();
    await pill.focus();
    await page.keyboard.press('Enter');
    const input = page.locator('#categories-list input[type="text"]').first();
    await input.fill('股票基金');
    await input.press('Enter');

    await expect(page.locator('#stress-bar-text')).toContainText('股票基金 60%');
    await page.locator('#tabs-assets .tab-btn[data-tab="assets"]').click();
    await expect(page.locator('#masthead-whole')).toHaveText('210,000');
  });
});

test.describe('压测：派生读数跟着变', () => {
  test('行内改金额：条与报头副行当场重算（不是只有净资产动）', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundKeepTo60(page);
    await expect(page.locator('#masthead-whole')).toHaveText('210,000');
    await expect(page.locator('#stress-bar-text')).toContainText('未归类 ¥50,000.00');

    // 把「未归类」（不在压测维度里，恒不打折）从 50k 改成 90k：
    // 净资产 210k→250k、条的未归类口径句、报头副行的原值与加权跌幅必须**同一拍**跟上。
    // 旧接线只刷了净资产与可见图表，于是同一屏上「原值 ¥290,000 / -13.8%」配着「未归类 ¥50,000」。
    const cell = page.locator('#assets-rows .asset-row[data-id="a-untagged"] .amount-cell');
    await cell.click();
    await cell.locator('input').fill('90000');
    await cell.locator('input').press('Enter');

    await expect(page.locator('#masthead-whole')).toHaveText('250,000');
    await expect(page.locator('#stress-bar-text')).toContainText('未归类 ¥90,000.00');
    await expect(page.locator('#masthead-sub')).toContainText('原值 ¥290,000');
    await expect(page.locator('#masthead-sub')).toContainText('压测 -13.8%');
    await expect(page.locator('#stress-badge-pct')).toHaveText(' -13.8%');
  });

  test('覆盖率与「能撑多久」都按压测后算', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundKeepTo60(page);

    await page.locator('#tabs-assets .tab-btn[data-tab="income"]').click();
    await page.locator('#cov-mode-cash').click();
    await expect(page.locator('#cov-reading')).toContainText('覆盖 2.9%');

    await page.locator('#mode-expenses').click();
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await page.locator('#runway-guide button').click();
    await expect(page.locator('#runway-modal')).toBeVisible();
    await page.locator('#runway-tag-groups .tag-choice', { hasText: '权益基金' }).click();
    await page.locator('#runway-modal .btn-gold').click();
    await expect(page.locator('#runway-num')).toHaveText('¥60,000.00');
    await expect(page.locator('#runway-months')).toHaveText('1 年'); // 12 个月按既有口径写作「1 年」
  });

  test('维度下拉排除内置「货币类型」；默认剩满，换维度清空旧比例', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);

    const options = await page.locator('#stress-dimension option').allTextContents();
    expect(options).toEqual(['资产类型', '风险等级']);

    const readings0 = page.locator('#stress-modal .scale-reading');
    await expect(readings0.first()).toBeVisible();
    for (const t of await readings0.allTextContents()) expect(t).toBe('100%');

    // 在「资产类型」下设比例，换到「风险等级」后滑块全部回 100%（不同维度的标签不同名）
    const slider = page.locator('#stress-modal input[type="range"]').nth(1);
    await slider.fill('50');
    await slider.dispatchEvent('input');
    await page.locator('#stress-dimension').selectOption('cat-risk');
    const readings = page.locator('#stress-modal .scale-reading');
    await expect(readings.first()).toBeVisible();
    for (const t of await readings.allTextContents()) expect(t).toBe('100%');
  });

  test('取消不落库（草稿制）', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    const slider = page.locator('#stress-modal input[type="range"]').nth(1);
    await slider.fill('50');
    await slider.dispatchEvent('input');
    await page.locator('#stress-modal .btn-ghost', { hasText: '取消' }).click();
    await expect(page.locator('#stress-modal')).toBeHidden();

    await expect(page.locator('#masthead-whole')).toHaveText('250,000');
    await expect(page.locator('#stress-bar-text')).toHaveText('压测：未启用');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wealth-manager-data')).stress);
    expect(stored).toBe(null);
  });
});
