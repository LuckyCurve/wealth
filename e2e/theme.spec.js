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

const KNOWN_HARDCODED = new Set([
  'rgb(220, 182, 180)',     // #dcb6b4  .btn-danger 描边（亮色）
  'rgb(90, 58, 57)',        // #5a3a39  .btn-danger 描边（暗色）
  // .modal-overlay 遮罩已改走 --scrim 变量，不再挂清单（灯下一张遮罩只有一处颜色来源）
  // .mo-badge.up / .toast-success（亮/暗同值）——底色/字色与 sage green pill 基色
  // （CATEGORY_COLORS[1]）同值，已归入 pill 调色板的允许集，故不再被巡检判为越界；
  // 描边仍是清单项。注意这是个巧合耦合：pill 基色一改，这两项会重新被点亮。
  'rgb(184, 223, 196)',     // #b8dfc4  描边（亮）
  'rgb(28, 42, 32)',        // #1c2a20  底（暗）
  'rgb(45, 68, 53)',        // #2d4435  描边（暗）
  'rgb(252, 232, 224)',     // #fce8e0  底（亮）
  'rgb(240, 200, 184)',     // #f0c8b8  描边（亮）
  'rgb(42, 28, 26)',        // #2a1c1a  底（暗）
  'rgb(74, 44, 42)',        // #4a2c2a  描边（暗）
  'rgb(248, 241, 222)',     // #f8f1de  底（亮）
  'rgb(227, 211, 163)',     // #e3d3a3  描边（亮）
  'rgb(41, 34, 20)',        // #292214  底（暗）
  'rgb(69, 58, 32)',        // #453a20  描边（暗）
]);

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

const switchToDark = async (page) => {
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('#theme-seg-dark').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveClass(/dark/);
};

const fmt = (list) =>
  [...new Set(list.map((o) => `${o.color}  ${o.where}:${o.prop}`))].sort().join('\n  ');
test.describe('主题色一致性', () => {
  test('状态栏颜色跟着应用主题（不是系统主题，也不是写死的色值）', async ({ appPage: page }) => {
    // 回归：手机浏览器的地址栏/状态栏取 <meta name=theme-color>。它必须与 --bg 同值——
    // 写死一份就会在调色时与纸面漂移，用 prefers-color-scheme 则会在「系统亮、页面暗」时反色。
    const chrome = await page.evaluate(() => ({
      meta: document.querySelector('meta[name="theme-color"]')?.content || null,
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    }));
    expect(chrome.meta).toBeTruthy();
    expect(chrome.meta.toLowerCase()).toBe(chrome.bg.toLowerCase());

    await switchToDark(page);
    const darkChrome = await page.evaluate(() => ({
      meta: document.querySelector('meta[name="theme-color"]')?.content || null,
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    }));
    expect(darkChrome.bg).not.toBe(chrome.bg);
    expect(darkChrome.meta.toLowerCase()).toBe(darkChrome.bg.toLowerCase());
  });

  test('亮色模式：无元素使用浏览器默认外观（漏设样式）', async ({ appPage: page }) => {
    // 回归：分类 pill 里的 ✕ 删除按钮只设了 color，background/border 走 UA 默认，
    // 在暖色古纸主题上是个灰底黑边的系统按钮
    const { ua } = await scan(page);
    expect(ua, `这些元素没设样式，吃到浏览器默认外观：\n  ${fmt(ua)}`).toEqual([]);
  });

  test('暗色模式：无元素使用浏览器默认外观（漏设样式）', async ({ appPage: page }) => {
    await switchToDark(page);

    const { ua } = await scan(page);
    expect(ua, `这些元素没设样式，吃到浏览器默认外观：\n  ${fmt(ua)}`).toEqual([]);
  });

  test('两套主题下写死色值不超出已知清单（清单只减不增）', async ({ appPage: page }) => {
    const light = await scan(page);

    await switchToDark(page);
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
    await switchToDark(page);
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

test.describe('打印形态：暗色主题也要印得出、印得清', () => {
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const lum = (c) => 0.2126 * lin(c.r / 255) + 0.7152 * lin(c.g / 255) + 0.0722 * lin(c.b / 255);
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const rgb = (s) => {
    const n = (s.match(/[\d.]+/g) || []).map(Number);
    return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 };
  };
  const WHITE = { r: 255, g: 255, b: 255 };

  test('暗色主题打印：正文与次要文字对白纸都达 AA（4.5:1）', async ({ appPage: page }) => {
    await switchToDark(page);
    await page.emulateMedia({ media: 'print' });

    const colors = await page.evaluate(() => {
      const pick = (el) => (el ? getComputedStyle(el).color : null);
      return {
        body: pick(document.body),
        muted: pick(document.querySelector('.muted') || document.querySelector('.setting-desc')),
        subtitle: pick(document.querySelector('.section-head .sub')),
      };
    });
    for (const [name, c] of Object.entries(colors)) {
      expect(c, `${name} 在打印媒体下取不到颜色`).toBeTruthy();
      const r = ratio(rgb(c), WHITE);
      expect(r, `${name} 打印在白纸上只有 ${r.toFixed(2)}:1（需 ≥4.5:1）`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('暗色主题打印：玻璃材质退场（不印成一块半透明色块）', async ({ appPage: page }) => {
    await switchToDark(page);
    await page.emulateMedia({ media: 'print' });
    const glass = await page.evaluate(() => {
      const card = document.querySelector('.card');
      const cs = getComputedStyle(card);
      return { backdrop: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor };
    });
    expect(glass.backdrop, '打印时 backdrop-filter 必须关掉（纸张印不出模糊）').toMatch(/none/);
    // 打印时卡片底色必须不透明：半透明压在纸上就是一片脏灰
    expect(rgb(glass.bg).a, '打印时卡片底色必须不透明').toBe(1);
  });

  test('打印：装饰层与操作面不进纸（灯层 / 便条 / 页签栏 / 操作行）', async ({ appPage: page }) => {
    await page.emulateMedia({ media: 'print' });
    const hidden = await page.evaluate(() => {
      const disp = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return 'missing';
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.visibility === 'hidden' ? 'hidden' : 'visible';
      };
      return {
        lamp: disp('.lamp-layer'),
        toasts: disp('#toast-area'),
        tabBar: disp('.tab-bar'),
        toolbar: disp('.toolbar'),
      };
    });
    for (const [name, state] of Object.entries(hidden)) {
      expect(state, `打印时 ${name} 仍在纸面上（应为 hidden）`).toBe('hidden');
    }
  });

  test('打印：真的能出一份非空 PDF（不是只改了计算样式）', async ({ appPage: page }) => {
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: false });
    expect(pdf.length, 'PDF 内容为空').toBeGreaterThan(1000);
  });
});
