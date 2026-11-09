const { test, expect, gotoAssets, readAppState, LS_KEY } = require('./fixtures');

/*
 * 年化换算：独立工具页（不挂资产）。
 * 填两个时点的净值 → 复利年化 + 单利年化；输入随存档落盘，刷新后还在。
 */

const row = (i) => `#yield-rows .yield-row:nth-child(${i + 2})`; // 第 1 行是列头

async function fillPoints(page, points) {
  for (let i = 0; i < points.length; i++) {
    if (i >= 2) await page.locator('#yield-add').click();
    await page.locator(`${row(i)} input[type=date]`).fill(points[i][0]);
    await page.locator(`${row(i)} input[type=text]`).fill(points[i][1]);
  }
}

test.describe('年化换算', () => {
  test('整年 1.0 → 1.05：复利与单利都读作 +5.00%', async ({ appPage: page }) => {
    await gotoAssets(page, 'yield');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);

    const result = page.locator('#yield-result');
    await expect(result).toContainText('+5.00%');
    await expect(result).toContainText('365 天');
    await expect(result).toContainText('单利年化 +5.00%');
    await expect(result).not.toContainText('区间不足');
  });

  test('半年 1.0 → 1.03：复利高于单利（两个口径都给）', async ({ appPage: page }) => {
    await gotoAssets(page, 'yield');
    await fillPoints(page, [['2025-01-01', '1'], ['2025-07-02', '1.03']]);

    const result = page.locator('#yield-result');
    await expect(result).toContainText('182 天');
    await expect(result).toContainText('+6.11%'); // 复利（几何）
    await expect(result).toContainText('单利年化 +6.02%');
  });

  test('三个时点给出逐段表，全段仍是首尾', async ({ appPage: page }) => {
    await gotoAssets(page, 'yield');
    await fillPoints(page, [
      ['2025-01-01', '1'],
      ['2025-04-02', '1.01'],
      ['2025-07-02', '1.03'],
    ]);

    const segs = page.locator('#yield-result .yield-seg');
    await expect(segs).toHaveCount(3); // 表头 + 两段
    await expect(segs.nth(1)).toContainText('91');
    await expect(segs.nth(2)).toContainText('91');
    await expect(page.locator('#yield-result')).toContainText('+3.00%'); // 全段累计
  });

  test('短区间给警示，脏行只点名不连累别的行', async ({ appPage: page }) => {
    await gotoAssets(page, 'yield');
    await fillPoints(page, [['2025-01-01', '1'], ['2025-01-04', '1.001']]);
    await expect(page.locator('#yield-result')).toContainText('区间不足 7 天');

    await page.locator(`${row(1)} input[type=text]`).fill('0');
    await expect(page.locator('#yield-result')).toContainText('1 行日期或净值无效');
  });

  test('输入随存档落盘：刷新后还在，清空也落盘', async ({ appPage: page }) => {
    await gotoAssets(page, 'yield');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await expect(page.locator(`${row(0)} input[type=date]`)).toHaveValue('2025-01-01');

    // 落盘有 400ms 节流：等存档里真的出现这一行，而不是 sleep 一个数
    await expect.poll(
      () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').yieldCalc?.rows?.[1]?.nav, LS_KEY)
    ).toBe('1.05');
    await page.reload();
    await page.waitForFunction(() => !!document.getElementById('masthead-date')?.textContent);
    await gotoAssets(page, 'yield');
    await expect(page.locator(`${row(0)} input[type=date]`)).toHaveValue('2025-01-01');
    await expect(page.locator(`${row(1)} input[type=text]`)).toHaveValue('1.05');

    await page.locator('#tab-yield button', { hasText: '清空' }).click();
    await expect(page.locator(`${row(0)} input[type=date]`)).toHaveValue('');
    await expect(page.locator(`${row(0)} input[type=text]`)).toHaveValue('');
    const rows = await page.evaluate(() => state.yieldCalc.rows);
    expect(rows.every((r) => r.date === '' && r.nav === '')).toBe(true);
  });

  test('不读资产：没有资产也能算（空账本）', async ({ blankPage: page }) => {
    await gotoAssets(page, 'yield');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await expect(page.locator('#yield-result')).toContainText('+5.00%');
    expect((await readAppState(page)).assets).toHaveLength(0);
  });

  test('落盘位置独立：换算器的输入不冒充资产', async ({ appPage: page }) => {
    await gotoAssets(page, 'yield');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await expect.poll(
      () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').yieldCalc?.rows?.[0]?.date, LS_KEY)
    ).toBe('2025-01-01');
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LS_KEY);
    expect(saved.yieldCalc.rows).toHaveLength(2);
    expect(saved.assets.some((a) => a.name.includes('1.05'))).toBe(false);
  });
});

test.describe('年化换算 · 语言', () => {
  test('切换界面语言：静态页头与脚本拼的读数一起换', async ({ appPage: page }) => {
    await gotoAssets(page, 'yield');
    await expect(page.locator('#tab-yield')).toContainText('填两个时点的净值');

    await page.evaluate(() => setLang('en'));
    await expect(page.locator('#tab-yield')).toContainText('Enter NAV at two dates');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await expect(page.locator('#yield-result')).toContainText('Compound annual');

    await page.evaluate(() => setLang('zh'));
    await expect(page.locator('#yield-result')).toContainText('复利年化');
    await expect(page.locator('#yield-result')).toContainText('365 天');
  });
});
