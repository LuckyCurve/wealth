/*
 * e2e/i18n.spec.js — 界面语言（默认英文，设置里切中文）
 * --------------------------------------------------------------------------
 * 单测能守住「每条文案都有词条」，守不住「切了语言页面真的变了」：
 * html lang、日期控件、图表、动态模板都可能在切换后留在旧语言（离线渲染的模板尤其）。
 * 这里用真实浏览器跑一遍，并把「英文界面里没有中文残留」做成一次全 Tab 巡检。
 *
 * 语言是用户设置（随存档落盘）：默认英文，所以既有 spec 播种时显式选中文（见 fixtures），
 * 本文件负责验证「不播种 = 英文」与切换本身。
 */
const {
  test, expect, stubCdn, seed, waitReady, disableMotion, gotoAssets, INDEX_URL, LS_KEY,
} = require('./fixtures');

const CJK = /[\u4e00-\u9fff]/;

async function openWith(page, state) {
  await disableMotion(page);
  await stubCdn(page);
  await seed(page, state);
  await page.goto(INDEX_URL);
  await waitReady(page);
}

// 界面上可见的文字（body.innerText 只取渲染后的文本，不含属性与 hidden）
const visibleText = (page) => page.evaluate(() => document.body.innerText);

/** 英文数据：巡检英文界面时，用户数据本身不能含中文（否则「有没有漏译」分不清） */
const enState = () => ({
  ...require('./fixtures').EMPTY_STATE,
  lang: 'en',
  categories: [
    { id: 'currency', name: 'Currency', builtin: true, tags: ['CNY', 'HKD', 'USD'] },
    { id: 'cat-type', name: 'Asset type', builtin: false, tags: ['Cash', 'Fund'] },
    { id: 'cat-risk', name: 'Risk', builtin: false, tags: ['Low', 'High'] },
  ],
  assets: [
    { id: 'a-cash', name: 'Bank savings', amount: 50000, currency: 'CNY', tags: { currency: 'CNY', 'cat-type': 'Cash', 'cat-risk': 'Low' }, expectedRateMin: 0.25, expectedRateMax: 0.35, cashRatio: 100 },
    { id: 'a-fund', name: 'Index fund', amount: 80000, currency: 'CNY', tags: { currency: 'CNY', 'cat-type': 'Fund', 'cat-risk': 'High' }, expectedRateMin: 5, expectedRateMax: 8, cashRatio: 20 },
  ],
  expenseCategories: [
    { id: 'ec-pay', name: 'Payment', builtin: false, tags: ['Card', 'Cash'] },
    { id: 'ec-type', name: 'Category', builtin: false, tags: ['Food', 'Housing'] },
  ],
  expenses: [
    { id: 'e-1', date: '2026-01-05', amount: 88.5, note: 'Lunch', tags: { 'ec-pay': 'Card', 'ec-type': 'Food' } },
    { id: 'e-2', date: '2026-02-03', amount: 3200, note: 'Rent', tags: { 'ec-pay': 'Card', 'ec-type': 'Housing' } },
  ],
  expenseExpectation: 5000,
  snapshots: [
    { month: '2026-01', note: '', currencyRates: { CNY: 1, HKD: 0.92, USD: 7.24 }, assets: [
      { id: 'a-cash', name: 'Bank savings', amount: 50000, currency: 'CNY', tags: { currency: 'CNY', 'cat-type': 'Cash', 'cat-risk': 'Low' }, expectedRateMin: 0.25, expectedRateMax: 0.35, cashRatio: 100 },
    ] },
  ],
});

test.describe('语言：默认与切换', () => {
  test('全新用户默认英文：文案、<html lang>、页面标题都是英文', async ({ page }) => {
    await openWith(page, null);

    await expect(page.locator('.brand-title')).toHaveText('Wealth Management');
    await expect(page.locator('header button[onclick="showSettings()"]')).toHaveText('Settings');
    await expect(page.locator('#mode-expenses')).toHaveText('Expenses');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    expect(await page.title()).toBe('Wealth Management');
    // 落盘的存档里语言也是 en（汇率刷新会顺手 saveState，不能拿「存档不存在」当判据）
    expect((await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LS_KEY)).lang).toBe('en');
  });

  test('设置里切中文：静态文案、动态模板、html lang 一起换，并落盘', async ({ page }) => {
    await openWith(page, null);
    await page.locator('header button[onclick="showSettings()"]').click();
    await page.locator('#lang-seg-zh').click();

    await expect(page.locator('.brand-title')).toHaveText('财富管理');
    await expect(page.locator('#mode-expenses')).toHaveText('消费');
    await expect(page.locator('#lang-seg-zh')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#lang-seg-en')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN');
    // 动态模板（空态副标题由 JS 写入）也跟着换
    await expect(page.locator('#expenses-empty-title')).toHaveText('还没有消费记录');

    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LS_KEY);
    expect(stored.lang).toBe('zh');
  });

  test('刷新后语言保持（语言是存档字段，不是内存开关）', async ({ page }) => {
    await openWith(page, null);
    await page.locator('header button[onclick="showSettings()"]').click();
    await page.locator('#lang-seg-zh').click();
    await expect(page.locator('.brand-title')).toHaveText('财富管理');

    await page.reload();
    await waitReady(page);
    await expect(page.locator('.brand-title')).toHaveText('财富管理');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN');
  });

  test('切回英文：中文用户也能回到英文（且不再写回中文）', async ({ page }) => {
    await openWith(page, { lang: 'zh' });
    await expect(page.locator('.brand-title')).toHaveText('财富管理');
    await page.locator('header button[onclick="showSettings()"]').click();
    await page.locator('#lang-seg-en').click();
    await expect(page.locator('.brand-title')).toHaveText('Wealth Management');
    expect((await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LS_KEY)).lang).toBe('en');
  });

  test('语言不影响账本内容：分类名、标签、备注保持原样', async ({ page }) => {
    await openWith(page, {
      lang: 'zh',
      categories: [
        { id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] },
        { id: 'cat-type', name: '资产类型', builtin: false, tags: ['活期现金'] },
      ],
      assets: [
        { id: 'a1', name: '招商银行活期', amount: 1000, currency: 'CNY', tags: { currency: 'CNY', 'cat-type': '活期现金' }, expectedRateMin: 0, expectedRateMax: 0, cashRatio: 100 },
      ],
    });
    await page.locator('header button[onclick="showSettings()"]').click();
    await page.locator('#lang-seg-en').click();
    await page.keyboard.press('Escape');
    await gotoAssets(page);
    await expect(page.locator('#assets-rows .asset-row')).toContainText('招商银行活期');
    await expect(page.locator('#categories-list .card', { hasText: '资产类型' })).toHaveCount(1);
  });
});

test.describe('英文界面的完整性巡检', () => {
  test('全部 Tab 与主要弹窗里没有中文残留（用户数据本身用英文播种）', async ({ page }) => {
    await openWith(page, enState());

    const walk = async (label) => {
      const text = await visibleText(page);
      // 「中文」是语言选项，故意用中文写（语言名各写各的），不算漏译
      const bad = text.replace(/中文/g, '').match(new RegExp(CJK.source + '+', 'g'));
      expect(bad, `${label} 里残留中文：${(bad || []).join(' / ')}`).toBeNull();
    };

    await walk('消费记录');
    for (const tab of ['expense-categories', 'expense-chart', 'expense-trend']) {
      await page.locator(`#tabs-expenses .tab-btn[data-tab="${tab}"]`).click();
      await walk(tab);
    }
    await gotoAssets(page);
    for (const tab of ['assets', 'categories', 'chart', 'history', 'income']) {
      await page.locator(`#tabs-assets .tab-btn[data-tab="${tab}"]`).click();
      await walk(tab);
    }

    // 弹窗：设置（语言/外观/备份三行说明文字最多）、登记资产、记录消费、备份与导入
    await page.locator('header button[onclick="showSettings()"]').click();
    await walk('设置弹窗');
    await page.keyboard.press('Escape');

    await page.locator('#mode-expenses').click();
    await page.locator('#tab-expenses button:has-text("Add expense")').click();
    await walk('消费弹窗');
    await page.keyboard.press('Escape');

    await gotoAssets(page);
    await page.locator('#tab-assets button:has-text("Add asset")').click();
    await walk('资产弹窗');
    await page.keyboard.press('Escape');
  });

  test('英文长文案不撑破卡片（说明文字行宽与换行都正常）', async ({ page }) => {
    await openWith(page, null);
    await page.locator('header button[onclick="showSettings()"]').click();
    const desc = page.locator('#settings-modal .setting-desc').first();
    const box = await desc.boundingBox();
    const docWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.width).toBeLessThanOrEqual(docWidth);
    // 长句必须换行，而不是一条被裁掉的横条
    const lines = await desc.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBeGreaterThan(1);
  });
});
