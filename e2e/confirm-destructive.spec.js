/*
 * e2e/confirm-destructive.spec.js — 清空 / 删除 / 覆盖一律二次确认
 * --------------------------------------------------------------------------
 * 用户原话：「清空或者删除操作需要二次确认，比如 Stress scenario 的 Clear 就没有」。
 * 单测（ui-wiring）只能守住「接线经过 showConfirm」；取消之后内存态与存档是否真的没动、
 * 确认之后才落盘，只有真实浏览器能验。这里每条用例都走「取消 → 断言没变 → 确认 → 断言变了」。
 *
 * 压测情景与备份文件夹两个入口的同类用例分别在 stress.spec.js / backup-dir.spec.js
 * （它们各自需要专门的播种与原生选择器替身）。
 */
const {
  test, expect, stubCdn, seed, waitReady, disableMotion,
  sampleState, INDEX_URL, readAppState, gotoAssets,
} = require('./fixtures');

async function setup(page, patch = {}) {
  await disableMotion(page);
  await stubCdn(page);
  await seed(page, { ...sampleState(), ...patch });
  await page.goto(INDEX_URL);
  await waitReady(page);
}

const readSaved = (page, key) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem('wealth-manager-data'))[k], key);

const cancelConfirm = async (page) => {
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-modal').getByRole('button', { name: '取消' }).click();
  await expect(page.locator('#confirm-modal')).toBeHidden();
};

const okConfirm = async (page) => {
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('#confirm-modal')).toBeHidden();
};

test('「清除」预期月消费：取消不改存档，确认才归零', async ({ page }) => {
  await setup(page, { expenseExpectation: 5000 });
  await page.evaluate(() => openExpectationModal());
  await expect(page.locator('#expectation-modal')).toBeVisible();

  await page.locator('#expectation-modal .btn-danger').click();
  await cancelConfirm(page);
  expect(await page.evaluate(() => state.expenseExpectation)).toBe(5000);
  expect(await readSaved(page, 'expenseExpectation')).toBe(5000);
  await expect(page.locator('#expectation-modal')).toBeVisible();

  await page.locator('#expectation-modal .btn-danger').click();
  await okConfirm(page);
  expect(await page.evaluate(() => state.expenseExpectation)).toBe(0);
  expect(await readSaved(page, 'expenseExpectation')).toBe(0);
  await expect(page.locator('#expectation-modal')).toBeHidden();
});

test('「清除」目标净资产：取消不改存档，确认才归零', async ({ page }) => {
  await setup(page, { netWorthTarget: 1000000 });
  await page.evaluate(() => openTargetModal());
  await expect(page.locator('#target-modal')).toBeVisible();

  await page.locator('#target-modal .btn-danger').click();
  await cancelConfirm(page);
  expect(await page.evaluate(() => state.netWorthTarget)).toBe(1000000);
  expect(await readSaved(page, 'netWorthTarget')).toBe(1000000);
  await expect(page.locator('#target-modal')).toBeVisible();

  await page.locator('#target-modal .btn-danger').click();
  await okConfirm(page);
  expect(await page.evaluate(() => state.netWorthTarget)).toBe(0);
  expect(await readSaved(page, 'netWorthTarget')).toBe(0);
  await expect(page.locator('#target-modal')).toBeHidden();
});

test('分类卡片的标签 ✕：取消保住标签与归类，确认才删除', async ({ page }) => {
  await setup(page);
  await gotoAssets(page, 'categories');
  const pill = page.locator('#categories-list .tag-pill', { hasText: '权益基金' }).first();
  const snapshot = () => page.evaluate(() => ({
    tags: state.categories.find((c) => c.id === 'cat-type').tags,
    tagged: state.assets.filter((a) => a.tags['cat-type'] === '权益基金').length,
  }));

  await pill.locator('.pill-del').click();
  await cancelConfirm(page);
  const before = await snapshot();
  expect(before.tags).toContain('权益基金');
  expect(before.tagged).toBe(1);

  await pill.locator('.pill-del').click();
  await okConfirm(page);
  const after = await snapshot();
  expect(after.tags).not.toContain('权益基金');
  expect(after.tagged).toBe(0);
});

test('导入 JSON 覆盖全部数据：取消不改存档，确认才覆盖', async ({ page }) => {
  await setup(page);
  const payload = {
    categories: [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] }],
    assets: [], snapshots: [], expenseCategories: [], expenses: [],
  };
  const chooseFile = () => page.setInputFiles('#import-file', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });

  await page.evaluate(() => showImportExport());
  await expect(page.locator('#io-modal')).toBeVisible();

  await chooseFile();
  await cancelConfirm(page);
  expect((await readAppState(page)).assets).toHaveLength(3);
  expect(await readSaved(page, 'assets')).toHaveLength(3);
  await expect(page.locator('#import-file-name')).toHaveText(''); // 取消 = 没发生过
  await expect(page.locator('#io-modal')).toBeVisible();

  await chooseFile();
  await okConfirm(page);
  expect((await readAppState(page)).assets).toHaveLength(0);
  expect(await readSaved(page, 'assets')).toHaveLength(0);
  await expect(page.locator('#io-modal')).toBeHidden();
});
