/*
 * e2e/theme.spec.js — 主题色一致性
 * --------------------------------------------------------------------------
 * AGENTS.md 的颜色系统约定：「一律用 CSS 变量而非写死色值；分类色 catColor/expenseCatColor
 * 为单一来源」。这条靠人眼巡检守不住——本文件让浏览器把所有元素的计算色扫一遍，
 * 凡不在「主题允许集」里的都列出来（含是哪个元素、哪个属性）。
 *
 * 允许集不是手写的白名单，而是在页面内**从主题自身求值**得来的：
 *   :root / :root.dark 的 CSS 变量（按当前模式取一套）
 *   ∪ catColor / expenseCatColor 对真实分类×标签的求值（pill 调色板，暗色分支另算）
 *   ∪ CATEGORY_PALETTE（图表调色板）
 * 因此给主题新增一个变量或改一个分类色，允许集自动跟着变，不需要改测试。
 *
 * 两类「越界」要分开看，判据不同：
 *   - UA 默认色（rgb(0,0,0)/rgb(240,240,240)/…）——症状是「漏设样式」：元素用浏览器
 *     默认外观，在暖色古纸主题上很突兀。属于缺陷，但不该算进「写死色值」。
 *   - 写死色值——直接违反颜色系统约定。KNOWN_HARDCODED 是现状快照：修一处删一行，
 *     不允许加行（见下面注释）。
 */
const { test, expect, visitAllTabs, collectOffThemeColors, UA_DEFAULT_COLORS } = require('./fixtures');

/**
 * 已知的写死色值（主题色板之外）。这是**待清理清单**，不是豁免名单：
 * 每修一处就从这里删一行；新增一处会让下面的测试变红。
 * 全部集中在语义色（涨/跌/信息徽章与便条）和几处按钮描边上，改它们要同步亮/暗两套。
 */
const KNOWN_HARDCODED = new Set([
  'rgb(143, 103, 19)',      // #8f6713  .btn-gold 描边（gold-600，未提成变量）
  'rgb(220, 182, 180)',     // #dcb6b4  .btn-danger 描边（亮色）
  'rgb(90, 58, 57)',        // #5a3a39  .btn-danger 描边（暗色）
  'rgba(13, 11, 8, 0.5)',   // .modal-overlay 遮罩
  // .mo-badge.up / .toast-success（亮/暗同值）
  'rgb(232, 245, 236)',     // #e8f5ec  底（亮）
  'rgb(61, 122, 82)',       // #3d7a52  字（亮）
  'rgb(184, 223, 196)',     // #b8dfc4  描边（亮）
  'rgb(28, 42, 32)',        // #1c2a20  底（暗）
  'rgb(45, 68, 53)',        // #2d4435  描边（暗）
  // .toast-error（error 语义色只在便条出现时渲染，此前因时机碰巧从未被扫到）
  'rgb(252, 232, 224)',     // #fce8e0  底（亮）
  'rgb(240, 200, 184)',     // #f0c8b8  描边（亮）
  'rgb(42, 28, 26)',        // #2a1c1a  底（暗）
  'rgb(74, 44, 42)',        // #4a2c2a  描边（暗）
  // .toast-info（同上：确定性触发后新暴露）
  'rgb(248, 241, 222)',     // #f8f1de  底（亮）
  'rgb(227, 211, 163)',     // #e3d3a3  描边（亮）
  'rgb(41, 34, 20)',        // #292214  底（暗）
  'rgb(69, 58, 32)',        // #453a20  描边（暗）
]);

/** 扫一遍所有视图，按「UA 默认 / 写死色值」分堆 */
async function scan(page) {
  await visitAllTabs(page);
  const { offenders } = await collectOffThemeColors(page);
  const ua = [];
  const hardcoded = [];
  for (const o of offenders) {
    if (UA_DEFAULT_COLORS.has(o.color)) ua.push(o);
    else hardcoded.push(o);
  }
  return { ua, hardcoded };
}

const fmt = (list) =>
  [...new Set(list.map((o) => `${o.color}  ${o.where}:${o.prop}`))].sort().join('\n  ');

test.describe('主题色一致性', () => {
  test('亮色模式：无元素使用浏览器默认外观（漏设样式）', async ({ appPage: page }) => {
    // 回归：分类 pill 里的 ✕ 删除按钮只设了 color，background/border 走 UA 默认，
    // 在暖色古纸主题上是个灰底黑边的系统按钮
    const { ua } = await scan(page);
    expect(ua, `这些元素没设样式，吃到浏览器默认外观：\n  ${fmt(ua)}`).toEqual([]);
  });

  test('暗色模式：无元素使用浏览器默认外观（漏设样式）', async ({ appPage: page }) => {
    await page.getByRole('button', { name: '设置' }).click();
    await page.locator('#theme-seg-dark').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const { ua } = await scan(page);
    expect(ua, `这些元素没设样式，吃到浏览器默认外观：\n  ${fmt(ua)}`).toEqual([]);
  });

  test('两套主题下写死色值不超出已知清单（清单只减不增）', async ({ appPage: page }) => {
    const light = await scan(page);

    await page.getByRole('button', { name: '设置' }).click();
    await page.locator('#theme-seg-dark').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const dark = await scan(page);

    const seen = new Set([...light.hardcoded, ...dark.hardcoded].map((o) => o.color));
    const unknown = [...seen].filter((c) => !KNOWN_HARDCODED.has(c));
    expect(
      unknown,
      `出现清单外的写死色值，请改为 CSS 变量（或确认后补进 KNOWN_HARDCODED）：\n  ${fmt([...light.hardcoded, ...dark.hardcoded].filter((o) => !KNOWN_HARDCODED.has(o.color)))}`
    ).toEqual([]);

    // 清单里的项若已被清理（不再出现），测试会提醒把条目删掉，避免清单无限膨胀
    const cleanedUp = [...KNOWN_HARDCODED].filter((c) => !seen.has(c));
    expect(cleanedUp, `这些写死色值已不存在，请从 KNOWN_HARDCODED 删除：${cleanedUp.join(', ')}`).toEqual([]);
  });

  test('主题变量在两套模式下都完整定义（无空值、无遗漏）', async ({ appPage: page }) => {
    const readVars = () =>
      page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const isDark = document.documentElement.classList.contains('dark');
        const out = {};
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules; } catch (e) { continue; }
          for (const r of rules) {
            if (!r.selectorText) continue;
            const sel = r.selectorText.trim();
            if (!/^:root(\.dark)?$/.test(sel)) continue;
            if (sel.includes('dark') !== isDark) continue;
            for (const p of r.style) if (p.startsWith('--')) out[p] = cs.getPropertyValue(p).trim();
          }
        }
        return out;
      });

    const light = await readVars();
    await page.getByRole('button', { name: '设置' }).click();
    await page.locator('#theme-seg-dark').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const dark = await readVars();

    expect(Object.keys(light).length).toBeGreaterThan(0);
    // 两套模式的变量必须一一对应：漏定义一个，暗色下该处就会回落到亮色值或透明
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    for (const k of Object.keys(light)) {
      expect(light[k], `亮色 ${k} 为空`).toBeTruthy();
      expect(dark[k], `暗色 ${k} 为空`).toBeTruthy();
    }
  });
});
