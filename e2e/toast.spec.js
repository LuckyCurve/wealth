const { test, expect, stubExternal, seed, waitReady, disableMotion, INDEX_URL } = require('./fixtures');

const MSG = '这句话要看清';

async function boot(page) {
  await disableMotion(page);
  await stubExternal(page);
  await page.clock.install();
  await seed(page, { lang: 'zh', categories: [], assets: [], snapshots: [], expenses: [], expenseCategories: [] });
  await page.goto(INDEX_URL);
  await waitReady(page);
  await page.evaluate((m) => toast(m, 'info'), MSG);
}

const toast = (page) => page.locator('#toast-area .toast', { hasText: MSG });

test('没人碰它：2.5 秒后退场（对照，否则「一直在」也可能是根本没接上）', async ({ page }) => {
  await boot(page);
  await page.mouse.move(5, 5);
  await expect(toast(page)).toHaveCount(1);
  await page.clock.runFor(4000);
  await expect(toast(page)).toHaveCount(0);
});

test('鼠标停在便条上：多久都不走；移开后才走', async ({ page }) => {
  await boot(page);
  await toast(page).hover();
  await page.clock.runFor(10000);
  await expect(toast(page)).toHaveCount(1);

  await page.mouse.move(5, 5);
  await page.clock.runFor(2000);
  await expect(toast(page)).toHaveCount(0);
});

test('便条上的文字被选中：不走；清除选区后才走', async ({ page }) => {
  await boot(page);
  await page.mouse.move(5, 5);
  await page.evaluate((m) => {
    const el = [...document.querySelectorAll('#toast-area .toast')].find((t) => t.textContent === m);
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, MSG);
  await page.clock.runFor(10000);
  await expect(toast(page)).toHaveCount(1);

  await page.evaluate(() => getSelection().removeAllRanges());
  await page.clock.runFor(2000);
  await expect(toast(page)).toHaveCount(0);
});
