const { test, expect } = require('@playwright/test');
const { gotoAssets, waitReady } = require('./fixtures');

/*
 * 脚本按七个文件加载（app-core → app-assets → app-charts → app-settings → app-expenses → app-calendar → app-receipt），
 * 拆分之后「顶层字面量引用了后一个文件里的函数」不会在语法检查里现形——它只在浏览器里炸，
 * 而且只炸一次：控制台一行 ReferenceError，后面的接线全都不存在。
 * 这条用例只做一件事：把每个 Tab 与主要弹窗走一遍，全程不许有 pageerror。
 */
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('页面脚本全程不抛错（跨文件引用断了会在这里现形）', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('index.html');
  await waitReady(page);

  for (const tab of ['expenses', 'expense-categories', 'expense-chart', 'expense-trend']) {
    await page.evaluate((t) => switchTab(t), tab);
    await nextFrame(page);
  }
  await gotoAssets(page);
  for (const tab of ['assets', 'categories', 'chart', 'history', 'income']) {
    await page.evaluate((t) => switchTab(t), tab);
    await nextFrame(page);
  }
  // Tab 的绘制排在下一帧（afterTabPaint），双击一帧才等到那一次回调真正跑完。
  await nextFrame(page);

  for (const open of ['openStressModal()', 'openExpectationModal()', 'openCompareModal()', 'openExpenseCompareModal()']) {
    await page.evaluate((src) => eval(src), open);
    await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach((m) => { m.style.display = 'none'; }));
  }
  await page.evaluate(() => { state.lang = state.lang === 'zh' ? 'en' : 'zh'; applyI18nDom(); renderAll(); });
  await nextFrame(page);

  expect(errors, '页面脚本抛错：\n  ' + errors.join('\n  ')).toEqual([]);
});
