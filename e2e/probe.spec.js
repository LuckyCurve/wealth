const { test, sampleState, seed, stubCdn, waitReady, disableMotion, gotoAssets } = require('./fixtures');
test('diag: 排序指示器状态', async ({ page }) => {
  await disableMotion(page);
  await stubCdn(page);
  await seed(page, sampleState());
  await page.goto('index.html');
  await waitReady(page);
  await gotoAssets(page, 'assets');
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => ({
    sortBy: typeof sortBy !== 'undefined' ? sortBy : 'N/A',
    active: document.querySelectorAll('.sort-indicator.active').length,
    html: [...document.querySelectorAll('.sort-indicator')].map(x => x.id + ':' + x.className).join(' | '),
  }));
  console.log('BEFORE ' + JSON.stringify(before));
  const handle = page.locator('#assets-rows .asset-row[data-id="a-cash"] .drag-handle');
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    sortBy: typeof sortBy !== 'undefined' ? sortBy : 'N/A',
    active: document.querySelectorAll('.sort-indicator.active').length,
    html: [...document.querySelectorAll('.sort-indicator')].map(x => x.id + ':' + x.className).join(' | '),
  }));
  console.log('AFTER ' + JSON.stringify(after));
});
