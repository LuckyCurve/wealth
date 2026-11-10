/*
 * chart-resize.spec.js — 图表尺寸：容器的**可见尺寸**是唯一来源
 * --------------------------------------------------------------------------
 * 用户报的现象：「消费趋势那里的图表在全屏后，然后又缩小就会展示有问题，其他几个地方可能也有」。
 * 用真 echarts 实测（ECharts 替身量不出真实行为）：
 *   可见时  容器 [1054, 420] → 实例 [1054, 420]
 *   隐藏后 resize（切到别的 Tab 再缩放窗口 / 全屏再退出都会走到）→ 实例被压成 [100, 420]
 *   再回到那个 Tab（渲染只 setOption，不 resize）→ **容器 [886, 420]，实例仍是 [100, 420]**
 *   —— 图画在一个 100px 宽的画布上，用户看到的就是「图不对」。
 * 根因不止一处，但都可归到同一句：**图的尺寸没有盯住容器**——
 *   ① 只在 window resize 时统一 resize，而容器的尺寸还会因为别的原因变（切 Tab 的 display 翻转）；
 *   ② 那份 window resize 接线挂在「读档之后」的分支上（懒加载路径会整段被跳过）。
 * 故这里守的是一条不变量：**图可见时，它的尺寸必须等于容器的尺寸**。
 *
 * 替身（fixtures 的 ECharts stub）按容器尺寸建模，故隐藏时 resize 会把尺寸记成 0；
 * 本文件只断言「尺寸 == 容器」，两种失败（0 或真库的 100）都会红。
 */
const { test, expect, stubExternal, seed, waitReady, disableMotion, sampleState, gotoAssets, waitChart, expectChartFit } = require('./fixtures');

const open = async (page) => {
  await disableMotion(page);
  await stubExternal(page);
  await seed(page, sampleState());
  await page.goto('index.html');
  await waitReady(page);
};

const SURFACES = [
  { mode: 'assets', tab: 'chart', id: 'sunburst-chart', name: '资产分布' },
  { mode: 'assets', tab: 'history', id: 'history-chart', name: '历史净值' },
  { mode: 'assets', tab: 'income', id: 'income-chart', name: '收益测算' },
  { mode: 'expenses', tab: 'expense-chart', id: 'expense-sunburst-chart', name: '消费分布' },
  { mode: 'expenses', tab: 'expense-trend', id: 'expense-trend-chart', name: '消费趋势' },
];

const TREND = SURFACES.find((s) => s.id === 'expense-trend-chart'); // 用户报的那一个（其余四个同一条路）

const showSurface = async (page, s) => {
  if (s.mode === 'assets') await gotoAssets(page, s.tab);
  else {
    await page.locator('#mode-expenses').click();
    await page.locator(`#tabs-expenses .tab-btn[data-tab="${s.tab}"]`).click();
  }
  await waitChart(page, s.id);
};

const hideAllCharts = async (page) => {
  await page.locator('#mode-expenses').click();
  await page.locator('#tabs-expenses .tab-btn[data-tab="expenses"]').click();
  await expect(page.locator('#tab-expenses')).toBeVisible();
};

test.describe('图表尺寸：容器的可见尺寸是唯一来源', () => {
  test('在别的 Tab 上缩放窗口，不得把那个 Tab 的图做废（回到该 Tab 时尺寸必须等于容器）', async ({ page }) => {
    await open(page);
    await showSurface(page, TREND);
    await expectChartFit(page, 'expense-trend-chart', '初次显示');
    await hideAllCharts(page);
    await page.setViewportSize({ width: 1000, height: 700 });
    // 回到消费趋势：渲染函数只 setOption，尺寸必须由「盯住容器」那条路自己对齐
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await expectChartFit(page, 'expense-trend-chart', '隐藏期间缩放后回到该 Tab');
  });

  test('五个图表面逐个扫：切走 → 缩放 → 回来，尺寸都要等于容器', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const snap = (month, amount) => ({ month, note: '', totalCNY: 0, currencyRates: { ...state.rates }, assets: state.assets.map((a) => ({ ...a, amount })) });
      state.snapshots = [snap('2026-01', 1000), snap('2026-02', 2000)];
      renderHistoryTab();
    });
    for (const s of SURFACES) {
      await showSurface(page, s);
      await expectChartFit(page, s.id, `${s.name} 初次显示`);
      await hideAllCharts(page);
      await page.setViewportSize({ width: 1040, height: 720 });
      await showSurface(page, s);
      await expectChartFit(page, s.id, `${s.name} 隐藏期间缩放后`);
    }
  });

  test('当前可见的图，窗口缩放后立刻跟随（不依赖切 Tab）', async ({ page }) => {
    await open(page);
    await showSurface(page, TREND);
    await expectChartFit(page, 'expense-trend-chart', '初次显示');
    await page.setViewportSize({ width: 920, height: 680 });
    await expectChartFit(page, 'expense-trend-chart', '窗口缩放后');
  });
});
