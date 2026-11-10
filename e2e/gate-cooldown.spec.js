/*
 * gate-cooldown.spec.js — 资产页「解锁冷却」
 * --------------------------------------------------------------------------
 * 用户拍板：抄对一次后的冷却时长可选 关闭 / 1 / 5 / 15 / 30 分钟，默认 5 分钟。
 * 冷却只省掉「再抄一遍」这一步：
 *   - 从最近一次抄对起算，刷新页面仍有效，关掉浏览器失效（sessionStorage，不进存档）；
 *   - 错句不重置、也不延长冷却；冷却期间不记、不显示任何抄写内容；
 *   - 「立即锁定」随时结束冷却。
 * 门的本身（长按 + 数据保护）不因冷却改变，本文件只验免抄部分。
 */
const {
  test, expect, stubExternal, seed, waitReady, sampleState, readAppState,
} = require('./fixtures');

const STAMP = 'wealth-gate-unlocked-at';

async function open(page) {
  await page.locator('#mode-assets').focus();
  await page.keyboard.press('Enter');
}

async function copyThrough(page) {
  await expect(page.locator('#asset-gate-modal')).toBeVisible();
  const phrase = ((await page.locator('#asset-gate-phrase').textContent()) || '').trim();
  await page.locator('#asset-gate-input').fill(phrase);
  await page.keyboard.press('Enter');
  await expect(page.locator('#content-assets')).toBeVisible();
}

const backToExpenses = async (page) => {
  await page.locator('#mode-expenses').click();
  await expect(page.locator('#content-expenses')).toBeVisible();
};

const openSettings = (page) => page.getByRole('button', { name: /设置|Settings/ }).click();

const stamp = (page) => page.evaluate((k) => sessionStorage.getItem(k), STAMP);

test.describe('解锁冷却', () => {
  test('全新存档默认 5 分钟，设置里回显「5 分」', async ({ page }) => {
    await stubExternal(page);
    await seed(page, null);
    await page.goto('index.html');
    await waitReady(page);
    expect(await page.evaluate(() => state.gateCooldown)).toBe(5);

    await openSettings(page);
    await expect(page.locator('#gate-cool-5')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#gate-cool-off')).toHaveAttribute('aria-pressed', 'false');
  });

  test('抄对一次后冷却内不再抄；刷新仍有效；只记数字时间戳', async ({ page }) => {
    await stubExternal(page);
    await seed(page, { ...sampleState(), gateCooldown: 5 });
    await page.goto('index.html');
    await waitReady(page);

    await open(page);
    await copyThrough(page);
    const mark = await stamp(page);
    expect(mark, '抄对后必须留下冷却起点').toMatch(/^\d+$/);

    await backToExpenses(page);
    await open(page);
    await expect(page.locator('#content-assets')).toBeVisible();
    await expect(page.locator('#asset-gate-modal')).toBeHidden();

    // 刷新：sessionStorage 仍在，冷却继续；会话存储里除播种标记外只该有那个时间戳
    await page.reload();
    await waitReady(page);
    await backToExpenses(page);
    await open(page);
    await expect(page.locator('#content-assets')).toBeVisible();
    await expect(page.locator('#asset-gate-modal')).toBeHidden();

    const stored = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        out[k] = sessionStorage.getItem(k);
      }
      return out;
    });
    expect(stored[STAMP], '冷却只存时间戳').toBe(mark);
    // 冷却状态只允许两个键：E2E 自身的播种标记 + 时间戳；不记抄写内容
    expect(Object.keys(stored).sort()).toEqual(['__e2e_seeded__', STAMP].sort());
  });

  test('设置里改档持久化；关闭档结束冷却并恢复抄写', async ({ page }) => {
    await stubExternal(page);
    await seed(page, { ...sampleState(), gateCooldown: 5 });
    await page.goto('index.html');
    await waitReady(page);

    await openSettings(page);
    await page.locator('#gate-cool-15').click();
    expect((await readAppState(page)).gateCooldown).toBe(15);
    await page.reload();
    await waitReady(page);
    expect(await page.evaluate(() => state.gateCooldown), '选择要落盘').toBe(15);

    // 冷却中关掉：时间戳一并清掉，下次必须抄
    await open(page);
    await copyThrough(page);
    expect(await stamp(page)).toMatch(/^\d+$/);
    await backToExpenses(page);
    await openSettings(page);
    await page.locator('#gate-cool-off').click();
    expect(await page.evaluate(() => state.gateCooldown)).toBe(0);
    expect(await stamp(page), '关闭档要结束本次冷却').toBeNull();
    await page.keyboard.press('Escape');

    await open(page);
    await expect(page.locator('#asset-gate-modal')).toBeVisible();
    await page.locator('#asset-gate-modal button:has-text("不看")').click();
  });

  test('「立即锁定」立即结束冷却', async ({ page }) => {
    await stubExternal(page);
    await seed(page, { ...sampleState(), gateCooldown: 30 });
    await page.goto('index.html');
    await waitReady(page);

    await open(page);
    await copyThrough(page);
    await backToExpenses(page);

    await openSettings(page);
    await page.locator('#gate-lock-now').click();
    await expect(page.locator('#toast-area .toast', { hasText: '已立即锁定' })).toBeVisible();
    expect(await stamp(page)).toBeNull();
    await page.keyboard.press('Escape');

    await open(page);
    await expect(page.locator('#asset-gate-modal')).toBeVisible();
    await page.locator('#asset-gate-modal button:has-text("不看")').click();
  });

  test('抄错不刷新也不延长冷却起点', async ({ page }) => {
    await stubExternal(page);
    await seed(page, { ...sampleState(), gateCooldown: 1 });
    await page.goto('index.html');
    await waitReady(page);

    await open(page);
    await expect(page.locator('#asset-gate-modal')).toBeVisible();
    const phrase = ((await page.locator('#asset-gate-phrase').textContent()) || '').trim();
    await page.locator('#asset-gate-input').fill(phrase + '错');
    await page.keyboard.press('Enter');
    await expect(page.locator('#asset-gate-error')).toBeVisible();
    expect(await stamp(page), '错句不得写冷却起点').toBeNull();

    // 人为放一个已过期的起点：错句后必须原样不动
    const old = String(Date.now() - 2 * 60 * 1000);
    await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [STAMP, old]);
    await page.locator('#asset-gate-input').fill(phrase + '又错');
    await page.keyboard.press('Enter');
    await expect(page.locator('#asset-gate-error')).toBeVisible();
    expect(await stamp(page), '错句不得重置也不得延长').toBe(old);

    await page.locator('#asset-gate-input').fill(phrase);
    await page.keyboard.press('Enter');
    await expect(page.locator('#content-assets')).toBeVisible();
    expect(await stamp(page), '抄对才刷新起点').not.toBe(old);
  });
});
