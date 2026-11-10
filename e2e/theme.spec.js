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

// 清单已清空：提示条、危险描边、编辑态都改走 token。以后新增写死色值会直接红，
// 修掉它，不要往这里加。
const KNOWN_HARDCODED = new Set([]);

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
  test('暗色主题打印：正文与次要文字对纸面都达 AA（4.5:1）', async ({ appPage: page }) => {
    await switchToDark(page);
    await page.emulateMedia({ media: 'print' });

    const colors = await page.evaluate(() => {
      const pick = (el) => (el ? getComputedStyle(el).color : null);
      return {
        paper: getComputedStyle(document.body).backgroundColor,
        body: pick(document.body),
        muted: pick(document.querySelector('.muted') || document.querySelector('.setting-desc')),
        subtitle: pick(document.querySelector('.section-head .sub')),
      };
    });
    const paper = rgb(colors.paper);
    expect(paper.a, '打印纸面必须是不透明色（否则实际印出来是白纸）').toBe(1);
    for (const [name, c] of Object.entries(colors)) {
      if (name === 'paper') continue;
      expect(c, `${name} 在打印媒体下取不到颜色`).toBeTruthy();
      const r = ratio(rgb(c), paper);
      expect(r, `${name} 打印在纸面上只有 ${r.toFixed(2)}:1（需 ≥4.5:1）`).toBeGreaterThanOrEqual(4.5);
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

  test('打印：装饰层与操作面不进纸（灯层 / 便条 / 页签栏 / 筛选 / 行内按钮 / 拖拽把手）', async ({ appPage: page }) => {
    await page.emulateMedia({ media: 'print' });
    const hidden = await page.evaluate(() => {
      const disp = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return 'missing';
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.visibility === 'hidden' ? 'hidden' : 'visible';
      };
      const allHidden = (sel) => {
        const els = [...document.querySelectorAll(sel)];
        if (!els.length) return 'missing';
        return els.every((el) => getComputedStyle(el).display === 'none') ? 'hidden' : 'visible';
      };
      return {
        lamp: disp('.lamp-layer'),
        toasts: disp('#toast-area'),
        tabBar: disp('.tab-bar'),
        toolbar: disp('.toolbar'),
        // 页头的模式切换与按钮也是操作面，且会带金/青蓝墨色进纸
        headerNav: allHidden('.app-header .seg-control, .app-header .btn-ghost'),
        // 筛选、编辑/复制/删除、拖拽排序都是屏上操作，纸上只留账目
        filterBar: allHidden('#expense-table .filter-bar'),
        rowActions: allHidden('.row-actions'),
        dragHandles: allHidden('.drag-handle'),
      };
    });
    for (const [name, state] of Object.entries(hidden)) {
      expect(state, `打印时 ${name} 仍在纸面上（应为 hidden）`).toBe('hidden');
    }

    // 明细在屏上默认收起，纸上必须自动展开；标签在纸上不能留省略号
    const paper = await page.evaluate(() => {
      const table = document.getElementById('expense-table');
      const tag = document.querySelector('#expenses-rows .tag-pill');
      return {
        detail: table ? getComputedStyle(table).display : 'missing',
        tagWrap: tag ? getComputedStyle(tag).whiteSpace : 'missing',
      };
    });
    expect(paper.detail, '打印时明细必须展开（不能要求先点一下再印）').toBe('block');
    expect(paper.tagWrap, '打印时标签必须能换行显示全文').toBe('normal');
  });

  test('打印：真的能出一份非空 PDF（不是只改了计算样式）', async ({ appPage: page }) => {
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: false });
    expect(pdf.length, 'PDF 内容为空').toBeGreaterThan(1000);
  });
});
