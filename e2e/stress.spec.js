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
 * 走键盘通道进资产页（fixtures.gotoAssets），不依外网、不用 waitForTimeout。
 */
const {
  test, expect, seed, stubCdn, waitReady, disableMotion, gotoAssets, EMPTY_STATE,
} = require('./fixtures');

// 播种一份带分类的账本：类型（活期/权益）+ 风险（低/高）+ 一笔未归类资产。
// 期望值便于心算：CNY 100k 活期 + 100k 权益 + 50k 未归类；权益 -50% → 净资产 200k。
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

/** 打开压测弹窗（资产侧条的「设置」） */
async function openStressModal(page) {
  await page.locator('#stress-bar .row-btn').click();
  await expect(page.locator('#stress-modal')).toBeVisible();
}

/** 在弹窗里把「权益基金」的跌幅滑到 50% 并保存（权益基金是第二个标签） */
async function setFundDropTo50(page) {
  const slider = page.locator('#stress-modal input[type="range"]').nth(1);
  await expect(slider).toBeVisible();
  await slider.fill('50');
  await slider.dispatchEvent('input');
  await expect(page.locator('#stress-modal .scale-reading').nth(1)).toHaveText('-50%');
  await page.locator('#stress-modal .btn-gold').click();
  await expect(page.locator('#stress-modal')).toBeHidden();
}

test.describe('压测：读数跟着变，账本不动', () => {
  test('未启用时条说「未启用」，启用后报头变小并给出原值', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);

    // 未启用：条在（入口）但只说未启用；印徽不显示
    await expect(page.locator('#stress-bar')).toBeVisible();
    await expect(page.locator('#stress-bar-text')).toHaveText('压测：未启用');
    await expect(page.locator('#stress-badge')).toBeHidden();
    await expect(page.locator('#masthead-whole')).toHaveText('250,000');

    await openStressModal(page);
    await setFundDropTo50(page);

    // 生效：250,000 → 200,000（权益 100k 腰斩），条列出跌幅 + 未归类口径句
    await expect(page.locator('#masthead-whole')).toHaveText('200,000');
    await expect(page.locator('#stress-bar-text')).toContainText('权益基金 -50%');
    await expect(page.locator('#stress-bar-text')).toContainText('未归类 ¥50,000.00 按未打折计入');
    // 报头副行给出原值对照 + 加权跌幅（50k 未归类不打折 → 加权 20%）
    await expect(page.locator('#masthead-sub')).toContainText('压测 -20.0%');
    await expect(page.locator('#masthead-sub')).toContainText('原值 ¥250,000');
    // 页头印徽出现（消费模式下也看得见压测生效）
    await expect(page.locator('#stress-badge')).toBeVisible();
    await expect(page.locator('#stress-badge-pct')).toHaveText(' -20.0%');
  });

  test('资产列表金额仍是原值（压测不写账本）', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundDropTo50(page);

    // 报头已是压测后的数，列表必须是账本原值——这是「只改读数」的核心断言
    await expect(page.locator('#masthead-whole')).toHaveText('200,000');
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
    await setFundDropTo50(page);

    // 压测生效下保存本月快照
    await page.locator('#tabs-assets .tab-btn[data-tab="history"]').click();
    await page.locator('#tab-history').getByRole('button', { name: '记录快照' }).click();
    await page.locator('#snapshot-note-modal .btn-gold').click();
    await expect(page.locator('#snapshot-note-modal')).toBeHidden();

    // 读存档：快照里的资产金额与 totalCNY 都是原值（不打折）
    const snap = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('wealth-manager-data'));
      const snap = s.snapshots[s.snapshots.length - 1];
      return { total: snap.totalCNY, amounts: snap.assets.map((a) => a.amount), stress: s.stress };
    });
    expect(snap.total).toBe(250000);
    expect(snap.amounts).toEqual([100000, 100000, 50000]);
    expect(snap.stress).toEqual({ catId: 'cat-type', drops: [{ tag: '权益基金', pct: 50 }] });
  });

  test('刷新后情景仍在（落盘），清除后回到真实值', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundDropTo50(page);
    await expect(page.locator('#masthead-whole')).toHaveText('200,000');

    await page.reload();
    await gotoAssets(page);
    // reload 后情景来自存档（不是重播）——这是「落盘」的唯一守卫
    await expect(page.locator('#masthead-whole')).toHaveText('200,000');
    await expect(page.locator('#stress-bar-text')).toContainText('权益基金 -50%');

    // 清除：立即回真实值，条回未启用
    await openStressModal(page);
    await page.locator('#stress-modal .btn-danger').click();
    await expect(page.locator('#masthead-whole')).toHaveText('250,000');
    await expect(page.locator('#stress-bar-text')).toHaveText('压测：未启用');
    await expect(page.locator('#stress-badge')).toBeHidden();
  });

  test('标签改名后情景跟着迁移（不静默失效）', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundDropTo50(page);

    // 长按分类卡片上的「权益基金」胶囊改名：键盘 Enter 直达改名
    await page.locator('#tabs-assets .tab-btn[data-tab="categories"]').click();
    const pill = page.locator('#categories-list .tag-pill', { hasText: '权益基金' }).first();
    await pill.focus();
    await page.keyboard.press('Enter');
    const input = page.locator('#categories-list input[type="text"]').first();
    await input.fill('股票基金');
    await input.press('Enter');

    // 改名后情景仍在（也不该被剪枝清掉）：条上出现新名，报头维持 200,000
    await expect(page.locator('#stress-bar-text')).toContainText('股票基金 -50%');
    await page.locator('#tabs-assets .tab-btn[data-tab="assets"]').click();
    await expect(page.locator('#masthead-whole')).toHaveText('200,000');
  });
});

test.describe('压测：派生读数跟着变', () => {
  test('覆盖率与「能撑多久」都按压测后算', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);
    await setFundDropTo50(page);

    // 覆盖率（现金口径，默认「使用最低」利率档）：
    //   活期 100k×1%×100% + 权益 50k×6%×20%（腰斩后本金）→ 年 1600 → 月 133.33；预期 5000 → 2.7%
    // 压测前的同口径是 100k×1% + 100k×6%×20% = 年 2200 → 月 183.33 → 3.7%（可与单测对照）
    await page.locator('#tabs-assets .tab-btn[data-tab="income"]').click();
    await page.locator('#cov-mode-cash').click();
    await expect(page.locator('#cov-reading')).toContainText('覆盖 2.7%');

    // 读数卡（消费趋势）：分子是「所选标签的钱」，压测生效时它同样打折。
    // 选「权益基金」这一个标签：原 100k → 腰斩 50k；÷ 月消费 5000 = 10 个月。
    await page.locator('#mode-expenses').click();
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    // 未选标签时读数行隐藏、入口在指引行里；chips 是 .tag-choice（aria-pressed 表达选中态）
    await page.locator('#runway-guide button').click();
    await expect(page.locator('#runway-modal')).toBeVisible();
    await page.locator('#runway-tag-groups .tag-choice', { hasText: '权益基金' }).click();
    await page.locator('#runway-modal .btn-gold').click();
    await expect(page.locator('#runway-num')).toHaveText('¥50,000.00');
    await expect(page.locator('#runway-months')).toHaveText('10 个月');
  });

  test('维度下拉排除内置「货币类型」；换维度清空旧跌幅', async ({ page }) => {
    await openStressPage(page);
    await gotoAssets(page);
    await openStressModal(page);

    const options = await page.locator('#stress-dimension option').allTextContents();
    expect(options).toEqual(['资产类型', '风险等级']);

    // 在「资产类型」下设跌幅，换到「风险等级」后滑块全部回 0（不同维度的标签不同名）
    const slider = page.locator('#stress-modal input[type="range"]').nth(1);
    await slider.fill('50');
    await slider.dispatchEvent('input');
    await page.locator('#stress-dimension').selectOption('cat-risk');
    const readings = page.locator('#stress-modal .scale-reading');
    await expect(readings.first()).toBeVisible();
    for (const t of await readings.allTextContents()) expect(t).toBe('-0%');
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

    // 取消 = 没发生过：报头维持原值，条仍未启用，存档里没有情景
    await expect(page.locator('#masthead-whole')).toHaveText('250,000');
    await expect(page.locator('#stress-bar-text')).toHaveText('压测：未启用');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wealth-manager-data')).stress);
    expect(stored).toBe(null);
  });
});
