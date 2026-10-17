/*
 * e2e/glass-material.spec.js — 卡片材质：液态玻璃「看得出是玻璃」的可测特征
 * --------------------------------------------------------------------------
 * 用户原话是「特效看着比较廉价」。廉价感来自三件**可量**的事，故这里逐条量：
 *   ① 底不够透——染色太实就与纸面只剩一条边的差别，材质消失，退回白板。
 *   ② 形状**没有受光方向**——四边一圈等亮，玻璃也是一块有描边的白板。
 *   ③ 背后是**纯色**——透光材质没有东西可透，blur 变成一笔没有观感的开销。
 * 另加一条护栏（开发中真实踩到的）：桌光在**页头下沿**会露出一道台阶（页头底色为过 AA
 * 巡检必须是不透明纯色），看着就是一条淡淡的横边。
 *
 * 关键判据读的是**渲染后的像素**（fixtures.samplePixels：截图交给浏览器自己解码），
 * 不是声明也不是计算样式——「写对了 class 但被覆盖 / 被后来的一层盖住」只有像素能看见，
 * 而这正是本次改动（材质）唯一能出问题的地方。数值口径：亮度取 AA 巡检同一套公式。
 *
 * 取样点都在**边中点**而非四角：卡片圆角 10px，落在弧线上的取样会读到描边的抗锯齿，
 * 得到与材质无关的假读数（本文件开发时就踩过一次）。
 */
const { test, expect, sampleState, seed, stubCdn, waitReady, disableMotion, samplePixels, pixelLum } = require('./fixtures');

/** 页面里最宽的那张卡片（表格卡），并给出它四条边中点的取样坐标 */
const cardEdges = (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('.card')].filter((c) => c.getBoundingClientRect().width > 900).pop();
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
        return { dx: nums[0], dy: nums[1], color: col };
      });
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      // 不透明底（rgb 形式没有第四个分量）要报成 alpha=1，否则断言会以 undefined 的形式莫名失败
      fillAlpha: (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || []).map(Number)[3] ?? 1,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      insets,
    };
  });

/** 顶/底边中点往里 1px 的亮度（受光边与背光边的实测对比） */
async function edgeLum(page, info) {
  const { x, y, w, h } = info.rect;
  const mid = x + w / 2;
  const [top, bottom] = await samplePixels(page, [[mid, y + 1], [mid, y + h - 2]]);
  return { top: pixelLum(top), bottom: pixelLum(bottom) };
}

const open = async (page) => {
  await disableMotion(page);
  await stubCdn(page);
  await seed(page, sampleState());
  await page.goto('index.html');
  await waitReady(page);
};

/** 切到暗色（入口唯一在设置弹窗里，与其余 spec 一致） */
const setDark = async (page) => {
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('#theme-seg-dark').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveClass(/dark/);
};

test.describe('卡片材质：液态玻璃的可测特征', () => {
  test('底透光过半：染色过实就与纸面只剩一条边的差别', async ({ page }) => {
    await open(page);
    const m = await cardEdges(page);
    expect(m.fillAlpha, '卡片底色必须透明（纸面与桌光要能透上来）').toBeGreaterThan(0);
    expect(m.fillAlpha, `底色不透明度 ${m.fillAlpha}：透光不过半时纸色透不上来`).toBeLessThanOrEqual(0.5);
    expect(m.backdropFilter, '背光模糊是玻璃的核心').toMatch(/blur\(/);
  });

  test('渲染后确有受光方向：顶边比底边亮（两套主题都要）', async ({ page }) => {
    await open(page);
    // 改前实测：顶 0.976 / 底 0.972（差 0.004，即「一圈等亮」），两套主题都是这个数
    for (const theme of ['亮色', '暗色']) {
      if (theme === '暗色') await setDark(page);
      const info = await cardEdges(page);
      const { top, bottom } = await edgeLum(page, info);
      expect(top - bottom, `【${theme}】顶边 ${top.toFixed(3)} vs 底边 ${bottom.toFixed(3)}：看不到受光方向`).toBeGreaterThan(0.02);
      // 声明侧的同一条约束（像素过了但源码被改成别的写法时，这里能说出是哪一条）
      const bright = info.insets.filter((s) => s.color && s.color.a > 0 && s.color.r + s.color.g + s.color.b > 3 * 200);
      const dark = info.insets.filter((s) => s.color && s.color.a > 0 && s.color.r + s.color.g + s.color.b < 3 * 200);
      expect(bright.length, `【${theme}】要有一枚亮的 inset（受光）`).toBeGreaterThan(0);
      expect(dark.length, `【${theme}】要有一枚暗的 inset（背光）`).toBeGreaterThan(0);
      expect(bright.some((s) => s.dy >= 0), `【${theme}】受光落在顶面/左上（dy ≥ 0）`).toBe(true);
      expect(dark.some((s) => s.dy <= 0), `【${theme}】背光落在底面/右下（dy ≤ 0）`).toBe(true);
    }
  });

  test('桌面上有一层静态光照（透光材质才有东西可透），且唯一「活」的光仍是台灯', async ({ page }) => {
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
    // 不只是「声明了」：真的渲染出明暗（左上受光 → 右下退光）
    const [tl, br] = await samplePixels(page, [[16, 200], [page.viewportSize().width - 16, page.viewportSize().height - 20]]);
    expect(pixelLum(tl) - pixelLum(br), `桌面看不出退光：左上 ${pixelLum(tl).toFixed(3)} vs 右下 ${pixelLum(br).toFixed(3)}`)
      .toBeGreaterThan(0.02);
  });

  test('页头下沿不得露出桌光的台阶（页头底色为 AA 巡检必须是不透明纯色）', async ({ page }) => {
    await open(page);
    const bottom = await page.evaluate(() => document.querySelector('.app-header').getBoundingClientRect().bottom);
    const xs = [40, 640, 1130];
    const pts = [];
    xs.forEach((x) => pts.push([x, bottom - 2], [x, bottom + 2]));
    const px = await samplePixels(page, pts);
    xs.forEach((x, i) => {
      const [above, below] = px.slice(i * 2, i * 2 + 2);
      // 桌光在页头底下露出台阶时，那里会横着一条「淡淡的边」——实测改前右端 4/255
      expect(Math.abs(below.r - above.r), `页头下沿 x=${x} 处有 ${below.r - above.r}/255 的台阶`).toBeLessThanOrEqual(2);
    });
  });
});
