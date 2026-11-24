/*
 * e2e/glass-material.spec.js — 卡片材质：半透厚纸的可测特征
 * --------------------------------------------------------------------------
 * 用户原话是「特效看着比较廉价」。纸卡的廉价感来自三件**可量**的事，故这里逐条量：
 *   ① 底必须半透明但读得出是纸（alpha .70–.82），且不再靠 backdrop-filter；
 *   ② 纸要压在桌上：卡心与同位置的桌下有明暗/色差（亮 ΔY ≥ .15、暗 ΔE76 ≥ 7）；
 *   ③ 不能有塑料倒角：左上−右下 ΔY 亮 ≤ .06、暗 ≤ .01。
 * 另守 --muted 对比、静态桌光、页头台阶，以及末尾的弹窗遮罩。
 *
 * 关键判据读的是**渲染后的像素**（fixtures.samplePixels：截图交给浏览器自己解码），
 * 不是声明也不是计算样式——「写对了 class 但被覆盖」只有像素能看见。数值口径：
 * 亮度为 sRGB 相对亮度（与 AA 巡检同一套公式），桌下取「临时隐藏卡片后的同一位置」。
 *
 * 取样点都在**边中点**而非四角：卡片圆角 10px，落在弧线上的取样会读到描边的抗锯齿，
 * 得到与材质无关的假读数（本文件开发时就踩过一次）。
 */
const { test, expect, sampleState, seed, stubExternal, waitReady, disableMotion, samplePixels } = require('./fixtures');

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];

const srgb = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const relLum = ({ r, g, b }) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const lab = ({ r, g, b }) => {
  const x = (0.4124 * srgb(r) + 0.3576 * srgb(g) + 0.1805 * srgb(b)) / 0.95047;
  const y = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const z = (0.0193 * srgb(r) + 0.1192 * srgb(g) + 0.9505 * srgb(b)) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
};
const deltaE76 = (a, b) => {
  const A = lab(a);
  const B = lab(b);
  return Math.hypot(A.L - B.L, A.a - B.a, A.b - B.b);
};
const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const medianColor = (px) => ({
  r: median(px.map((p) => p.r)),
  g: median(px.map((p) => p.g)),
  b: median(px.map((p) => p.b)),
});
const parseRgb = (value) => (value.match(/[\d.]+/g) || []).map(Number);

const cardEdges = (page) =>
  page.evaluate(() => {
    document.querySelectorAll('[data-paper-card-probe]').forEach((el) => delete el.dataset.paperCardProbe);
    const cards = [...document.querySelectorAll('.card')].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 300 && r.height > 80;
    });
    const area = (c) => {
      const r = c.getBoundingClientRect();
      return r.width * r.height;
    };
    const el = cards.reduce((best, c) => (!best || area(c) > area(best) ? c : best), null);
    if (!el) throw new Error('找不到可见的大卡片');
    el.dataset.paperCardProbe = '1';
    // 取样读的是视口截图：卡片在折叠线以下时读到的全是空白（0.000 而不是「没有受光」）
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const insets = cs.boxShadow
      .split(/,(?![^(]*\))/)
      .filter((s) => /inset/.test(s))
      .map((s) => {
        const nums = (s.match(/-?[\d.]+px/g) || []).map(parseFloat);
        const c = (s.match(/rgba?\([^)]+\)/) || [''])[0];
        const p = (c.match(/[\d.]+/g) || []).map(Number);
        const col = p.length ? { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } : null;
        return { dx: nums[0], dy: nums[1], blur: nums[2], spread: nums[3], color: col };
      });
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    const muted = getComputedStyle(probe).color;
    probe.remove();
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      fillAlpha: (cs.backgroundColor.match(/[\d.]+/g) || []).map(Number)[3] ?? 1,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      backgroundImage: cs.backgroundImage,
      shadowLayers: cs.boxShadow.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean),
      insets,
      muted,
      padding: parseFloat(cs.paddingLeft),
    };
  });

/** 卡片滚到视口中央后，量卡心/桌下/两角/正文对比；桌下取临时隐藏卡片后的同一位置。 */
async function samplePaper(page, info) {
  const { x, y, w, h } = info.rect;
  const cx = Math.round(x + w / 2);
  const cy = Math.round(y + h / 2);
  const pts = [];
  for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) pts.push([cx + dx, cy + dy]);
  const card = medianColor(await samplePixels(page, pts));
  await page.evaluate(() => {
    const el = document.querySelector('[data-paper-card-probe]');
    if (el) el.style.visibility = 'hidden';
  });
  const desk = medianColor(await samplePixels(page, pts));
  await page.evaluate(() => {
    const el = document.querySelector('[data-paper-card-probe]');
    if (el) el.style.visibility = '';
  });
  const [tl, br] = await samplePixels(page, [
    [Math.round(x + 14), Math.round(y + 14)],
    [Math.round(x + w - 14), Math.round(y + h - 14)],
  ]);
  const muted = parseRgb(info.muted);
  return {
    card,
    desk,
    dY: relLum(card) - relLum(desk),
    dE: deltaE76(card, desk),
    slope: relLum(tl) - relLum(br),
    mutedContrast: contrast(card, { r: muted[0], g: muted[1], b: muted[2] }),
  };
}

const open = async (page) => {
  await disableMotion(page);
  await stubExternal(page);
  await seed(page, sampleState());
  await page.goto('index.html');
  await waitReady(page);
};

const setDark = async (page) => {
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('#theme-seg-dark').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveClass(/dark/);
  // 弹窗的退场是过渡（顶层元素靠 overlay/display 的 allow-discrete 把遮罩留到动画结束）：
  // 遮罩还在的那几帧里采样，会量到一层均匀压暗（卡片自己的受光就变平）——等到 display 真变 none 再量。
  await expect
    .poll(async () => page.evaluate(() =>
      [...document.querySelectorAll('dialog.modal-overlay')].some((d) => getComputedStyle(d).display !== 'none')))
    .toBe(false);
};

const setLight = async (page) => {
  await page.evaluate(() => setTheme(false));
  await expect(page.locator('html')).not.toHaveClass(/dark/);
};

async function eachTheme(page, fn) {
  await setLight(page);
  await fn('亮色');
  await setDark(page);
  await fn('暗色');
  await setLight(page);
}

test.describe('卡片材质：半透厚纸的可测特征', () => {
  test('底色是半透明纸（alpha .70–.82），且卡片不再做 backdrop-filter', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    await open(page);
    const m = await cardEdges(page);
    expect(m.fillAlpha, '卡片底色必须半透明（纸面与桌光要透一点上来）').toBeGreaterThanOrEqual(0.70);
    expect(m.fillAlpha, `底色不透明度 ${m.fillAlpha}：超过 .82 就退回白板`).toBeLessThanOrEqual(0.82);
    expect(m.backdropFilter, '常驻卡片必须没有 backdrop-filter').toBe('none');
    expect(m.backgroundImage, '卡片不得用 background-image（AA 巡检会整块豁免）').toBe('none');
  });

  test('纸摊在桌上：亮色卡心−桌下 ΔY ≥ .15，暗色 ΔE76 ≥ 7（1280/390）', async ({ page }) => {
    await open(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await eachTheme(page, async (theme) => {
        const info = await cardEdges(page);
        const m = await samplePaper(page, info);
        if (theme === '亮色') {
          expect(
            m.dY,
            `【${theme} ${vp.width}】卡心 ${JSON.stringify(m.card)} vs 桌下 ${JSON.stringify(m.desk)}：${m.dY.toFixed(4)}，纸没摊在桌上`
          ).toBeGreaterThanOrEqual(0.15);
        } else {
          expect(
            m.dE,
            `【${theme} ${vp.width}】卡心 ${JSON.stringify(m.card)} vs 桌下 ${JSON.stringify(m.desk)}：ΔE76 ${m.dE.toFixed(2)}`
          ).toBeGreaterThanOrEqual(7);
        }
        console.log(`[paper] ${theme} ${vp.width} card=${JSON.stringify(m.card)} desk=${JSON.stringify(m.desk)} dY=${m.dY.toFixed(4)} dE=${m.dE.toFixed(2)}`);
      });
    }
  });

  test('没有塑料倒角：左上−右下 ΔY 亮 ≤ .06 / 暗 ≤ .01（1280/390）', async ({ page }) => {
    await open(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await eachTheme(page, async (theme) => {
        const info = await cardEdges(page);
        const m = await samplePaper(page, info);
        const limit = theme === '亮色' ? 0.06 : 0.01;
        expect(
          m.slope,
          `【${theme} ${vp.width}】左上−右下 ΔY ${m.slope.toFixed(4)}：超过 ${limit} 就是五层 inset 的塑料倒角`
        ).toBeLessThanOrEqual(limit);
      });
    }
  });

  test('--muted 在卡心不低于现状（亮 ≥5.49 / 暗 ≥5.87，1280/390）', async ({ page }) => {
    await open(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await eachTheme(page, async (theme) => {
        const info = await cardEdges(page);
        const m = await samplePaper(page, info);
        const floor = theme === '亮色' ? 5.49 : 5.87;
        expect(
          m.mutedContrast,
          `【${theme} ${vp.width}】--muted 对卡心 ${m.mutedContrast.toFixed(2)}:1，低于 ${floor}`
        ).toBeGreaterThanOrEqual(floor);
      });
    }
  });

  test('材质只有一条顶边受光 + 两层外阴影（不会退回五层 inset）', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    await open(page);
    const m = await cardEdges(page);
    expect(m.insets, '材质只能有一条 inset 受光边').toHaveLength(1);
    expect(m.insets[0].dx).toBe(0);
    expect(m.insets[0].dy).toBe(1);
    expect(m.shadowLayers.filter((l) => /inset/.test(l))).toHaveLength(1);
    expect(m.shadowLayers.filter((l) => !/inset/.test(l))).toHaveLength(2);
    const reach = Math.max(Math.abs(m.insets[0].dx), Math.abs(m.insets[0].dy)) + Math.abs(m.insets[0].blur || 0) + Math.abs(m.insets[0].spread || 0);
    expect(reach, '受光边的涉足范围必须小于卡片内边距').toBeLessThan(m.padding);
  });

  test('桌面上有一层静态光照（半透纸才有东西可透），且唯一「活」的光仍是台灯', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    await open(page);
    const desk = await page.evaluate(() => {
      const d = getComputedStyle(document.body, '::after');
      return { bg: d.backgroundImage, position: d.position, zIndex: d.zIndex, pointerEvents: d.pointerEvents };
    });
    expect(desk.position, '桌面光照是铺满视口的固定层，不跟着滚动跑').toBe('fixed');
    expect(desk.pointerEvents).toBe('none');
    expect(Number(desk.zIndex), '要落在纸纹之后（纸是铺在桌上的）').toBeLessThan(-1);
    expect(desk.bg, '桌面光照要有明暗层次，不能是空的').toMatch(/gradient\(/);
    expect(desk.bg, '桌面光照不得跟指针走（那就成了第二盏灯）').not.toMatch(/lamp/);
    const [tl, br] = await samplePixels(page, [[16, 200], [page.viewportSize().width - 16, page.viewportSize().height - 20]]);
    expect(relLum(tl) - relLum(br), `桌面看不出退光：左上 ${relLum(tl).toFixed(3)} vs 右下 ${relLum(br).toFixed(3)}`)
      .toBeGreaterThan(0.02);
  });

  test('页头下沿不得露出桌光的台阶（页头底色为 AA 巡检必须是不透明纯色）', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    await open(page);
    const bottom = await page.evaluate(() => document.querySelector('.app-header').getBoundingClientRect().bottom);
    const width = page.viewportSize().width;
    // 取**一整行的中位数**：台阶是整行的低频偏移，而纸纹（±5/255）与页头里的字都是少数点。
    const xs = [];
    for (let x = 8; x < width - 8; x += 2) xs.push(x);
    const pts = [];
    xs.forEach((x) => pts.push([x, bottom - 2], [x, bottom + 2]));
    const px = await samplePixels(page, pts);
    const med = (a) => {
      const v = a.map((p) => p.r).sort((m, n) => m - n);
      return v[Math.floor(v.length / 2)];
    };
    const above = med(px.filter((_, i) => i % 2 === 0));
    const below = med(px.filter((_, i) => i % 2 === 1));
    expect(Math.abs(below - above), `页头下沿有 ${below - above}/255 的台阶（整行中位数）`).toBeLessThanOrEqual(2);
  });

  test('弹窗遮罩：磨砂够深、色走 --scrim，正文保持不透明底（表单可读性）', async ({ page }) => {
    // 遮罩是弹窗与整个账本材质语言的衔接处：玻璃只留在这类短暂浮层上；
    // 磨砂半径 4px 时背后标题与数字仍隐约可辨，会抢弹窗正文的注意力。
    // 遮罩是 dialog 的 ::backdrop（磨砂留在 dialog 自己身上会连正文一起糊掉）。
    // 正文底必须不透明：半透明会把表单文字压在糊开的深色上，可读性先垮。
    await page.setViewportSize(VIEWPORTS[0]);
    await open(page);
    await page.evaluate(() => openModal('expense-modal'));
    const m = await page.evaluate(() => {
      const d = document.querySelector('dialog.modal-overlay[open]');
      const bd = getComputedStyle(d, '::backdrop');
      const blur = ((bd.backdropFilter || bd.webkitBackdropFilter || '').match(/blur\(([\d.]+)px\)/) || [])[1];
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--scrim').trim();
      const scrimVar = getComputedStyle(probe).color;
      probe.remove();
      const parts = (getComputedStyle(d).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      return { blur: blur ? parseFloat(blur) : 0, scrim: bd.backgroundColor, scrimVar, contentAlpha: parts[3] ?? 1 };
    });
    expect(m.blur, `遮罩磨砂只有 ${m.blur}px：背后的纸面会直接透出来`).toBeGreaterThanOrEqual(8);
    expect(m.scrimVar, '--scrim 必须在 :root 定义（遮罩颜色单一来源）').toBeTruthy();
    expect(m.scrim, '遮罩色必须从 --scrim 来（不再写死）').toBe(m.scrimVar);
    expect(m.contentAlpha, '弹窗正文底必须不透明（半透明会压掉表单文字的可读性）').toBe(1);
  });
});

/**
 * 弹窗的纸与深度：
 *   ① 弹窗是这页上**最大的一块纸**，却长期是不透明平涂 —— 纸纹只铺在桌面与页头。
 *      但纸纹不能爬进正文：AA 巡检按平底色算对比度，纤维会让它静默跳过。
 *      故判据是「内边距带里有纤维、正文列里没有」——两个取样点各取一条。
 *   ② 深度靠阴影色，而阴影色原先写死 rgba(0,0,0,.15)。暗色下压在 #16130e 上
 *      等于没有深度（黑压黑），故阴影色必须走变量、且两套主题各自成立。
 */
test.describe('弹窗：纸的纤维与深度', () => {
  const openModal = async (page) => {
    await page.evaluate(() => showSettings());
    await expect(page.locator('#settings-modal')).toBeVisible();
  };

  test('阴影色走变量：亮/暗两套各自成立', async ({ page }) => {
    await stubExternal(page);
    await seed(page, sampleState());
    await page.goto('index.html');
    await waitReady(page);
    await openModal(page);

    const probe = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.modal-overlay[open]'));
      const probeEl = document.createElement('span');
      document.body.appendChild(probeEl);
      const out = {};
      for (const v of ['--shadow-soft', '--shadow-lift']) {
        probeEl.style.color = cs.getPropertyValue(v).trim();
        out[v] = getComputedStyle(probeEl).color;
      }
      probeEl.remove();
      return { out, boxShadow: cs.boxShadow };
    });
    expect(probe.out['--shadow-soft'], '--shadow-soft 必须在 :root 定义（阴影色单一来源）').toBeTruthy();
    expect(probe.out['--shadow-lift'], '--shadow-lift 必须在 :root 定义').toBeTruthy();
    const shadows = {};
    for (const dark of [false, true]) {
      await page.evaluate((d) => setTheme(d), dark);
      shadows[dark ? 'dark' : 'light'] = await page.evaluate(() => getComputedStyle(document.querySelector('.modal-overlay[open]')).boxShadow);
    }
    expect(shadows.light, '亮色弹窗阴影取不到').toBeTruthy();
    expect(shadows.dark, '暗色弹窗阴影取不到').toBeTruthy();
    expect(shadows.dark, '暗色阴影不得与亮色完全相同（那说明色值是写死的）').not.toBe(shadows.light);
  });

  test('弹窗内边距带有纸纹，正文列保持纯色（AA 巡检的前提不破）', async ({ page }) => {
    await stubExternal(page);
    await seed(page, sampleState());
    await page.goto('index.html');
    await waitReady(page);
    await openModal(page);

    const info = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.modal-overlay[open]'), '::before');
      const padding = parseFloat(getComputedStyle(document.querySelector('.modal-overlay[open]')).paddingLeft) || 0;
      return {
        beforeContent: cs.content,
        maskImage: cs.maskImage || cs.webkitMaskImage,
        padding,
      };
    });
    expect(info.beforeContent, '弹窗纸纹由 ::before 承担').toContain('""');
    // 必须用 mask 收到内边距带：纤维不能爬到正文底下
    expect(info.maskImage, '纸纹必须用 mask 衰减收边（否则会铺满正文）').not.toBe('none');
    expect(info.padding, '内边距是纸纹的落脚范围').toBeGreaterThanOrEqual(24);
  });
});
